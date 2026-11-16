/*
# Change condition_remise from text to numeric (minimum deposit amount)

## Modified Tables

### `clients`
- `condition_remise` type changed from text to numeric(12,2)
  Now represents the minimum deposit total required for the discount to apply.
*/

-- Convert existing text values to numeric (null if not parseable)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'condition_remise' AND data_type = 'text'
  ) THEN
    -- Try to cast existing values, set non-numeric to NULL
    UPDATE clients SET condition_remise = NULL
      WHERE condition_remise IS NOT NULL
        AND condition_remise !~ '^[0-9]+(\.[0-9]+)?$';

    ALTER TABLE clients ALTER COLUMN condition_remise TYPE numeric(12,2)
      USING NULLIF(condition_remise, '')::numeric;
  END IF;
END $$;
