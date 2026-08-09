"""EstimationRiskEngine — scores a new Oracle Fusion estimate end-to-end.

Loads the trained UC-1 (deviation %) and UC-2 (overrun probability) models
plus the comparator dataset, and turns one project's inputs into:
  - predicted deviation % (point estimate + p25/p75 range)
  - overrun probability + risk band (GREEN/AMBER/RED) + historical band rate
  - top risk drivers for this specific prediction
  - the 5 most similar past projects (nearest-neighbour lookup)

Uses the champion model (XGBoost or Random Forest — training_summary.json
records which one actually won) for point predictions/probabilities, and
SHAP for driver explanation when the champion is tree-based. Falls back to
the explainable twin (Ridge/Logit) if a champion joblib file is missing.
"""
import json
import os

import joblib
import numpy as np
import pandas as pd

try:
    import shap
except ImportError:  # requirements.txt includes shap, but don't hard-fail without it
    shap = None

MODELS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'models'))


class EstimationRiskEngine:
    def __init__(self, models_dir: str = MODELS_DIR):
        self.models_dir = models_dir

        with open(os.path.join(models_dir, 'explainable_twin_coefficients.json'), encoding='utf-8') as f:
            self.coefficients = json.load(f)
        with open(os.path.join(models_dir, 'comparator_dataset.json'), encoding='utf-8') as f:
            self.comparators = pd.DataFrame(json.load(f))
        with open(os.path.join(models_dir, 'training_summary.json'), encoding='utf-8') as f:
            self.training_summary = json.load(f)

        self.numeric_features = self.coefficients['numeric_features']
        self.categorical_features = self.coefficients['categorical_features']
        self.feature_columns = self.numeric_features + self.categorical_features

        self.preprocessor = joblib.load(os.path.join(models_dir, 'uc1_preprocessor.joblib'))

        self.uc1_champion = self._load_optional('uc1_champion.joblib')
        self.uc1_ridge = joblib.load(os.path.join(models_dir, 'uc1_ridge_explainable.joblib'))
        self.uc1_q25 = joblib.load(os.path.join(models_dir, 'uc1_quantile_p25.joblib'))
        self.uc1_q75 = joblib.load(os.path.join(models_dir, 'uc1_quantile_p75.joblib'))

        self.uc2_champion = self._load_optional('uc2_champion.joblib')
        self.uc2_logit = joblib.load(os.path.join(models_dir, 'uc2_logit_explainable.joblib'))

        risk_bands = self.coefficients['risk_band_thresholds']
        self.amber_cut = risk_bands['amber']
        self.red_cut = risk_bands['red']
        self.empirical_by_band = self.coefficients['empirical_overrun_rate_by_band']

        # Same feature space the models were trained in, precomputed once so
        # nearest-neighbour lookup is a plain distance calc at request time.
        self._comparator_matrix = self.preprocessor.transform(self.comparators[self.feature_columns])

        self._uc2_shap = None
        if shap is not None and self.uc2_champion is not None and hasattr(self.uc2_champion, 'feature_importances_'):
            try:
                self._uc2_shap = shap.TreeExplainer(self.uc2_champion)
            except Exception as err:  # version-mismatch parsing issues, etc. — fall back to coefficients
                print(f'SHAP explainer unavailable ({err}); falling back to logistic-twin coefficients for drivers.')

    def _load_optional(self, filename):
        path = os.path.join(self.models_dir, filename)
        return joblib.load(path) if os.path.exists(path) else None

    def score(self, inputs: dict) -> dict:
        row = pd.DataFrame([{col: inputs[col] for col in self.feature_columns}])
        Xt = self.preprocessor.transform(row)

        # ── UC-1: predicted deviation % (point estimate + p25/p75 range) ──
        uc1_model = self.uc1_champion if self.uc1_champion is not None else self.uc1_ridge
        predicted_deviation_pct = float(uc1_model.predict(Xt)[0])
        range_low_pct = float(self.uc1_q25.predict(Xt)[0])
        range_high_pct = float(self.uc1_q75.predict(Xt)[0])
        if range_low_pct > range_high_pct:
            range_low_pct, range_high_pct = range_high_pct, range_low_pct

        # ── UC-2: overrun probability + risk band ──────────────────────────
        uc2_model = self.uc2_champion if self.uc2_champion is not None else self.uc2_logit
        overrun_probability = float(uc2_model.predict_proba(Xt)[0, 1])
        if overrun_probability >= self.red_cut:
            risk_band = 'RED'
        elif overrun_probability >= self.amber_cut:
            risk_band = 'AMBER'
        else:
            risk_band = 'GREEN'
        historical = self.empirical_by_band.get(risk_band, {})

        return {
            'ml_calibration': {
                'predicted_deviation_pct': round(predicted_deviation_pct, 1),
                'range_low_pct': round(range_low_pct, 1),
                'range_high_pct': round(range_high_pct, 1),
                'overrun_probability': round(overrun_probability, 4),
                'risk_band': risk_band,
                'historical_overrun_rate': historical.get('actual_overrun_rate'),
                'historical_n_projects': historical.get('n_projects'),
                'top_drivers': self._top_drivers(Xt),
                'model_used': {
                    'uc1': self.training_summary['uc1_deviation_regressor']['champion_model'] if self.uc1_champion is not None else 'ridge_twin',
                    'uc2': self.training_summary['uc2_overrun_classifier']['champion_model'] if self.uc2_champion is not None else 'logit_twin',
                },
            },
            'similar_projects': self._nearest_comparators(Xt, k=5),
        }

    def _top_drivers(self, Xt: np.ndarray, top_n: int = 5) -> list:
        feature_names = [n.split('__', 1)[-1] for n in self.coefficients['uc2_logit']['feature_order']]

        if self._uc2_shap is not None:
            raw = self._uc2_shap.shap_values(Xt)
            # Binary XGBClassifier/TreeExplainer returns a single (1, n_features)
            # array; some sklearn tree models return a list of per-class arrays.
            values = np.array(raw[1] if isinstance(raw, list) else raw).reshape(-1)
        else:
            coef = np.array(self.coefficients['uc2_logit']['coef'])
            values = coef * np.asarray(Xt).reshape(-1)

        order = np.argsort(-np.abs(values))[:top_n]
        return [{'feature': feature_names[i], 'contribution': round(float(values[i]), 3)} for i in order]

    def _nearest_comparators(self, Xt: np.ndarray, k: int = 5) -> list:
        dists = np.linalg.norm(self._comparator_matrix - Xt, axis=1)
        nearest_idx = np.argsort(dists)[:k]
        cols = ['project_id', 'industry', 'complexity', 'deviation_pct', 'overrun_flag', 'health']
        return self.comparators.iloc[nearest_idx][cols].to_dict(orient='records')


if __name__ == '__main__':
    engine = EstimationRiskEngine()
    example = {
        'complexity': 'H', 'industry': 'BFSI', 'n_modules': 4, 'n_entities': 6,
        'integ_simple': 20, 'integ_complex': 8, 'n_reports': 25, 'n_cemli': 12,
        'n_dm_objects': 15, 'duration_months': 20, 'team_size': 30,
        'integ_coverage_ratio': 0.67, 'dm_coverage_ratio': 0.80,
    }
    print(json.dumps(engine.score(example), indent=2))
