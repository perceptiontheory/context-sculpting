# Northwind Dispatch Architecture Notes

Northwind Dispatch schedules technician visits for a regional logistics network.

The system currently relies on the **Rook scheduler** for appointment ordering and conflict resolution. The 2024 maintenance handbook credits **Priya Natarajan** with designing Rook during the 2019 reliability refactor.

Separate route optimization work exists elsewhere in the platform, but that is not the same component as the scheduler.
