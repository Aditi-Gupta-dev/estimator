"""Trains UC-1 (deviation % regressor) and UC-2 (overrun classifier).

For each use case we train two things:
  - a "champion" model (XGBoost, compared against Random Forest) — higher
    accuracy, not portable/inspectable.
  - an "explainable twin" (Ridge for UC-1, Logistic Regression for UC-2, plus
    linear quantile regressors for UC-1's p25/p75 range) — lower accuracy,
    but its coefficients export cleanly to JSON (explainable_twin_coefficients.json)
    for use anywhere that can't load a joblib/pickle (e.g. the standalone
    browser demo, or a quick sanity check without the champion model file).

api.py serves predictions from the champion model when its joblib file is
present, and falls back to the explainable twin otherwise (see predict.py).
"""
import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, QuantileRegressor, Ridge
from sklearn.metrics import mean_squared_error, r2_score, roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold, train_test_split
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier, XGBRegressor

from features import ALL_FEATURES, CATEGORICAL_FEATURES, NUMERIC_FEATURES, load_feature_matrix

MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', 'models')
RANDOM_STATE = 42


def build_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(transformers=[
        ('num', StandardScaler(), NUMERIC_FEATURES),
        ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL_FEATURES),
    ])


def _feature_order(preprocessor: ColumnTransformer) -> list:
    return list(preprocessor.get_feature_names_out())


def train_uc1(df: pd.DataFrame, preprocessor: ColumnTransformer):
    X = df[ALL_FEATURES]
    y = df['deviation_pct'].values
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=RANDOM_STATE)

    Xt_train = preprocessor.fit_transform(X_train)
    Xt_test = preprocessor.transform(X_test)
    Xt_full = preprocessor.transform(X)

    # ── Champion: XGBoost, compared against Random Forest ──────────────────
    xgb = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE)
    xgb.fit(Xt_train, y_train)
    xgb_rmse = mean_squared_error(y_test, xgb.predict(Xt_test)) ** 0.5
    xgb_r2 = r2_score(y_test, xgb.predict(Xt_test))

    rf = RandomForestRegressor(n_estimators=300, max_depth=6, random_state=RANDOM_STATE)
    rf.fit(Xt_train, y_train)
    rf_rmse = mean_squared_error(y_test, rf.predict(Xt_test)) ** 0.5
    rf_r2 = r2_score(y_test, rf.predict(Xt_test))

    champion, champion_name = (xgb, 'xgboost') if xgb_rmse <= rf_rmse else (rf, 'random_forest')

    cv_rmses = []
    kf = KFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    for tr_idx, va_idx in kf.split(X):
        pp = build_preprocessor()
        Xt_tr = pp.fit_transform(X.iloc[tr_idx])
        Xt_va = pp.transform(X.iloc[va_idx])
        m = XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE)
        m.fit(Xt_tr, y[tr_idx])
        cv_rmses.append(mean_squared_error(y[va_idx], m.predict(Xt_va)) ** 0.5)

    # ── Explainable twin: Ridge (point) + linear quantile regressors (range) ──
    ridge = Ridge(alpha=1.0, random_state=RANDOM_STATE)
    ridge.fit(Xt_train, y_train)

    q25 = QuantileRegressor(quantile=0.25, alpha=0.01, solver='highs')
    q25.fit(Xt_train, y_train)
    q75 = QuantileRegressor(quantile=0.75, alpha=0.01, solver='highs')
    q75.fit(Xt_train, y_train)

    feature_order = _feature_order(preprocessor)

    # Filename is generic ("champion", not "xgboost") because Random Forest
    # sometimes wins the comparison — training_summary.json records which.
    joblib.dump(champion, os.path.join(MODELS_DIR, 'uc1_champion.joblib'))
    joblib.dump(ridge, os.path.join(MODELS_DIR, 'uc1_ridge_explainable.joblib'))
    joblib.dump(q25, os.path.join(MODELS_DIR, 'uc1_quantile_p25.joblib'))
    joblib.dump(q75, os.path.join(MODELS_DIR, 'uc1_quantile_p75.joblib'))

    summary = {
        'champion_model': champion_name,
        'test_rmse_pp': round(float(xgb_rmse if champion_name == 'xgboost' else rf_rmse), 2),
        'test_r2': round(float(xgb_r2 if champion_name == 'xgboost' else rf_r2), 3),
        'cv_rmse_pp_mean': round(float(np.mean(cv_rmses)), 2),
        'cv_rmse_pp_std': round(float(np.std(cv_rmses)), 2),
        'alt_model_rmse_pp': round(float(rf_rmse if champion_name == 'xgboost' else xgb_rmse), 2),
    }

    return {
        'ridge': ridge, 'q25': q25, 'q75': q75,
        'feature_order': feature_order, 'summary': summary,
        'Xt_full': Xt_full,
    }


def train_uc2(df: pd.DataFrame, preprocessor: ColumnTransformer):
    X = df[ALL_FEATURES]
    y = df['overrun_flag'].values
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y,
    )

    Xt_train = preprocessor.fit_transform(X_train)
    Xt_test = preprocessor.transform(X_test)
    Xt_full = preprocessor.transform(X)

    xgb = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE, eval_metric='logloss')
    xgb.fit(Xt_train, y_train)
    xgb_auc = roc_auc_score(y_test, xgb.predict_proba(Xt_test)[:, 1])

    rf = RandomForestClassifier(n_estimators=300, max_depth=6, random_state=RANDOM_STATE)
    rf.fit(Xt_train, y_train)
    rf_auc = roc_auc_score(y_test, rf.predict_proba(Xt_test)[:, 1])

    champion, champion_name = (xgb, 'xgboost') if xgb_auc >= rf_auc else (rf, 'random_forest')

    cv_aucs = []
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    for tr_idx, va_idx in skf.split(X, y):
        pp = build_preprocessor()
        Xt_tr = pp.fit_transform(X.iloc[tr_idx])
        Xt_va = pp.transform(X.iloc[va_idx])
        m = XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=RANDOM_STATE, eval_metric='logloss')
        m.fit(Xt_tr, y[tr_idx])
        cv_aucs.append(roc_auc_score(y[va_idx], m.predict_proba(Xt_va)[:, 1]))

    logit = LogisticRegression(max_iter=1000)
    logit.fit(Xt_train, y_train)

    # Predicted probabilities across the whole dataset, from the twin — used
    # to set risk-band thresholds and their empirical overrun rates below.
    all_proba = logit.predict_proba(Xt_full)[:, 1]

    feature_order = _feature_order(preprocessor)

    joblib.dump(champion, os.path.join(MODELS_DIR, 'uc2_champion.joblib'))
    joblib.dump(logit, os.path.join(MODELS_DIR, 'uc2_logit_explainable.joblib'))

    summary = {
        'champion_model': champion_name,
        'test_auc': round(float(xgb_auc if champion_name == 'xgboost' else rf_auc), 3),
        'cv_auc_mean': round(float(np.mean(cv_aucs)), 3),
        'cv_auc_std': round(float(np.std(cv_aucs)), 3),
        'alt_model_auc': round(float(rf_auc if champion_name == 'xgboost' else xgb_auc), 3),
    }

    return {
        'logit': logit, 'feature_order': feature_order, 'summary': summary,
        'all_proba': all_proba,
    }


def risk_bands_from_proba(proba: np.ndarray, y_true: np.ndarray):
    amber_cut = float(np.quantile(proba, 0.60))
    red_cut = float(np.quantile(proba, 0.90))
    band = np.where(proba >= red_cut, 'RED', np.where(proba >= amber_cut, 'AMBER', 'GREEN'))
    empirical = {}
    for b in ('GREEN', 'AMBER', 'RED'):
        mask = band == b
        empirical[b] = {
            'actual_overrun_rate': round(float(y_true[mask].mean()), 4) if mask.any() else 0.0,
            'n_projects': int(mask.sum()),
        }
    return {'amber': amber_cut, 'red': red_cut}, empirical


def main():
    os.makedirs(MODELS_DIR, exist_ok=True)
    df = load_feature_matrix()

    preprocessor_uc1 = build_preprocessor()
    uc1 = train_uc1(df, preprocessor_uc1)

    preprocessor_uc2 = build_preprocessor()
    uc2 = train_uc2(df, preprocessor_uc2)

    # Fit one shared preprocessor on the full dataset for serving-time use
    # (train_uc1/train_uc2 each fit their own on an 80% split for evaluation).
    serving_preprocessor = build_preprocessor()
    serving_preprocessor.fit(df[ALL_FEATURES])
    joblib.dump(serving_preprocessor, os.path.join(MODELS_DIR, 'uc1_preprocessor.joblib'))
    joblib.dump(serving_preprocessor, os.path.join(MODELS_DIR, 'uc2_preprocessor.joblib'))

    thresholds, empirical = risk_bands_from_proba(uc2['all_proba'], df['overrun_flag'].values)

    numeric_idx = {f: i for i, f in enumerate(NUMERIC_FEATURES)}
    coefficients = {
        'numeric_features': NUMERIC_FEATURES,
        'categorical_features': CATEGORICAL_FEATURES,
        'scaler_mean': serving_preprocessor.named_transformers_['num'].mean_.tolist(),
        'scaler_scale': serving_preprocessor.named_transformers_['num'].scale_.tolist(),
        'categories': {
            'complexity': serving_preprocessor.named_transformers_['cat'].categories_[0].tolist(),
            'industry': serving_preprocessor.named_transformers_['cat'].categories_[1].tolist(),
        },
        'uc1_ridge': {
            'coef': uc1['ridge'].coef_.tolist(),
            'intercept': float(uc1['ridge'].intercept_),
            'feature_order': uc1['feature_order'],
        },
        'uc1_quantile_p25': {
            'coef': uc1['q25'].coef_.tolist(),
            'intercept': float(uc1['q25'].intercept_),
            'feature_order': uc1['feature_order'],
        },
        'uc1_quantile_p75': {
            'coef': uc1['q75'].coef_.tolist(),
            'intercept': float(uc1['q75'].intercept_),
            'feature_order': uc1['feature_order'],
        },
        'uc2_logit': {
            'coef': uc2['logit'].coef_[0].tolist(),
            'intercept': float(uc2['logit'].intercept_[0]),
            'feature_order': uc2['feature_order'],
        },
        'risk_band_thresholds': thresholds,
        'empirical_overrun_rate_by_band': empirical,
        'training_ranges': {
            f: {
                'min': float(df[f].min()), 'max': float(df[f].max()), 'median': float(df[f].median()),
            } for f in NUMERIC_FEATURES
        },
        'industries': sorted(df['industry'].unique().tolist()),
        'complexities': ['L', 'M', 'H', 'VH'],
    }

    with open(os.path.join(MODELS_DIR, 'explainable_twin_coefficients.json'), 'w', encoding='utf-8') as f:
        json.dump(coefficients, f, indent=2)

    # Comparator dataset: anonymised (Project ID only) rows for the "most
    # similar past projects" nearest-neighbour lookup in predict.py.
    comparator_cols = ['Project ID'] + CATEGORICAL_FEATURES + NUMERIC_FEATURES + [
        'deviation_pct', 'overrun_flag', 'Project Health',
    ]
    comparators = df[comparator_cols].rename(columns={'Project ID': 'project_id', 'Project Health': 'health'})
    comparators.to_json(os.path.join(MODELS_DIR, 'comparator_dataset.json'), orient='records', indent=2)

    training_summary = {'uc1_deviation_regressor': uc1['summary'], 'uc2_overrun_classifier': uc2['summary']}
    with open(os.path.join(MODELS_DIR, 'training_summary.json'), 'w', encoding='utf-8') as f:
        json.dump(training_summary, f, indent=2)

    print(json.dumps(training_summary, indent=2))


if __name__ == '__main__':
    main()
