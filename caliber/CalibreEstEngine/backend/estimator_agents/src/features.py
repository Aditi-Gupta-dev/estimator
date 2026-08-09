"""Feature engineering for the Oracle Fusion estimation risk models (UC-1/UC-2).

Loads the 500-project execution dataset (``Project Master`` + ``Phase-Wise
Effort`` sheets) and builds the 13-input (11 numeric + 2 categorical) feature
matrix plus both targets:

  - UC-1 target: ``deviation_pct``  — continuous, project's Overall Deviation %
  - UC-2 target: ``overrun_flag``   — binary, 1 if deviation_pct > OVERRUN_THRESHOLD_PCT

``integ_coverage_ratio`` / ``dm_coverage_ratio`` aren't raw columns — the
dataset only tracks phase-level actuals, not integration/DM actuals
separately at the project-master level. We derive them as the project's own
Actual/Benchmark effort ratio for the "Ph4: Integration & SIT" and
"Ph6: Data Migration" phases (joined from Phase-Wise Effort by Project ID),
clipped to [0.75, 2.25]. This is the closest available proxy for "how much
more/less effort this phase actually took vs its own benchmark" — the same
signal the frontend estimates at prediction time from its own bottom-up
effort vs template baseline (see calibre-app's useEstimator.js).
"""
import os
import pandas as pd

DATASET_PATH = os.path.normpath(os.path.join(
    os.path.dirname(__file__), '..', '..', 'Oracle_Fusion_Execution_Dataset_500_1.xlsx',
))

NUMERIC_FEATURES = [
    'n_modules', 'n_entities', 'integ_simple', 'integ_complex', 'n_reports',
    'n_cemli', 'n_dm_objects', 'duration_months', 'team_size',
    'integ_coverage_ratio', 'dm_coverage_ratio',
]
CATEGORICAL_FEATURES = ['complexity', 'industry']
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

OVERRUN_THRESHOLD_PCT = 10.0  # dataset's own "ON TRACK" upper bound (README: -5% to +10%)
COVERAGE_RATIO_CLIP = (0.75, 2.25)

_COLUMN_RENAME = {
    '# Modules': 'n_modules',
    '# Entities': 'n_entities',
    'Integ Simple': 'integ_simple',
    'Integ Complex': 'integ_complex',
    '# Reports': 'n_reports',
    '# CEMLI': 'n_cemli',
    '# DM Objects': 'n_dm_objects',
    'Duration\n(months)': 'duration_months',
    'Team Size': 'team_size',
    'Complexity': 'complexity',
    'Industry': 'industry',
    'Overall\nDeviation %': 'deviation_pct',
}


def _phase_coverage_ratio(phase_effort: pd.DataFrame, phase_name: str) -> pd.Series:
    sub = phase_effort[phase_effort['SDLC Phase'] == phase_name]
    ratio = (sub['Actual\nEffort (days)'] / sub['Benchmark\nEffort (days)']).clip(*COVERAGE_RATIO_CLIP)
    return pd.Series(ratio.values, index=sub['Project ID'].values)


def load_feature_matrix(path: str = DATASET_PATH) -> pd.DataFrame:
    """Returns one row per project with ALL_FEATURES + deviation_pct + overrun_flag."""
    project_master = pd.read_excel(path, sheet_name='Project Master', header=1)
    phase_effort = pd.read_excel(path, sheet_name='Phase-Wise Effort', header=1)

    integ_ratio = _phase_coverage_ratio(phase_effort, 'Ph4: Integration & SIT')
    dm_ratio = _phase_coverage_ratio(phase_effort, 'Ph6: Data Migration')

    df = project_master.rename(columns=_COLUMN_RENAME).copy()
    df['integ_coverage_ratio'] = df['Project ID'].map(integ_ratio)
    df['dm_coverage_ratio'] = df['Project ID'].map(dm_ratio)
    df['overrun_flag'] = (df['deviation_pct'] > OVERRUN_THRESHOLD_PCT).astype(int)

    keep = ['Project ID'] + ALL_FEATURES + ['deviation_pct', 'overrun_flag', 'Project Health']
    return df[keep].dropna().reset_index(drop=True)


if __name__ == '__main__':
    matrix = load_feature_matrix()
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'feature_matrix.csv')
    matrix.to_csv(out_path, index=False)
    print(f'Wrote {len(matrix)} rows -> {out_path}')
    print(matrix[NUMERIC_FEATURES + ['deviation_pct', 'overrun_flag']].describe().to_string())
