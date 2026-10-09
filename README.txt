WAYMARK: Historical Advice Update Notes
========================================

This file records the earlier evidence-backed recommendation update. It is kept
for project history and is not a setup guide. Current setup, workflows, and
database safety instructions are in README.md.

The update added or changed these project files:

  New at the time:
    pipeline/__init__.py
    pipeline/advice.py
    pipeline/rebuild_advice.py
    backend/tests/test_advice.py

  Updated at the time:
    blackspot_pipeline.py
    frontend/src/components/map/DetailPanel.tsx

The historical file modified_files.diff documents those earlier edits. Do not
apply it to the current project without first checking whether the target files
already contain the changes; doing so may overwrite newer work.

The current advice refresh utility is run from the project root:

    python pipeline/rebuild_advice.py

It uses the saved model, features, and crash records to refresh cell factors and
recommendations. It does not retrain the risk model or refresh its scores and
metrics. By default, it creates waymark.db.before_advice if that backup does not
already exist. Review README.md before running database-changing utilities.
