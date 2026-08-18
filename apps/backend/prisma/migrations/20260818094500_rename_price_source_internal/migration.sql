-- The last Portuguese identifier left in the schema. Renamed as part of
-- the migration to English (see CLAUDE.md).
--
-- RENAME VALUE instead of dropping and recreating the type: it keeps any
-- rows that already reference the value. There are none today, but the
-- destructive version would only be found out the day there are.
ALTER TYPE "PriceSource" RENAME VALUE 'INTERNO' TO 'INTERNAL';
