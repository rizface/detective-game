-- Notes can quote a passage from the case and remember where and when they were written.
ALTER TABLE notes
    ADD COLUMN quote  text    NOT NULL DEFAULT '', -- a passage the player selected
    ADD COLUMN source text    NOT NULL DEFAULT '', -- where it came from: doc:ID, person:ID, loc:ID, event:N, chapter:ID, case:intro
    ADD COLUMN clock  integer NOT NULL DEFAULT 0,  -- in-game minutes when the note was written
    ADD COLUMN at_loc text    NOT NULL DEFAULT ''; -- where the team was at the time
