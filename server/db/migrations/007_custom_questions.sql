-- Questions beyond the original seventy.
--
-- The answers table capped question_n at 70, which was right while the bank was
-- fixed and wrong as soon as an administrator can add one: answers to question
-- 71 would have been rejected by the check constraint, and the only symptom
-- would have been a silently unscored area.
--
-- The upper bound goes; the lower one stays, because a question number is a
-- position in the bank and zero is not one.

ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_question_n_check;
ALTER TABLE answers ADD CONSTRAINT answers_question_n_check CHECK (question_n >= 1);
