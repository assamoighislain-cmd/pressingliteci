/*
# Make mode_reglement nullable on depots

## Overview
A depot may not be settled by the client at deposit time. This migration
makes `mode_reglement` nullable so the deposit can be recorded without
a payment mode.

## Modified Tables
### `depots`
- `mode_reglement` is now nullable (was NOT NULL)
*/

ALTER TABLE depots ALTER COLUMN mode_reglement DROP NOT NULL;
