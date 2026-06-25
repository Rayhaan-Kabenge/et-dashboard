"""Field Health module — satellite vegetation indices for a user-defined field.

Fully isolated from the irrigation engine: nothing here imports `et_engine`,
`compute`, `sheets`, or `weather`, and the engine path never imports this package.
Mounted only when `FEATURE_FIELD_HEALTH` is on.
"""
