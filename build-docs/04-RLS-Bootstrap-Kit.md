## RLS Bootstrap Kit (Clone-ready)

קובץ: `supabase/bootstrap/rls_base.sql`

### איך משתמשים
1) פתח Supabase Dashboard → SQL Editor
2) הדבק והרץ את תוכן הקובץ `supabase/bootstrap/rls_base.sql`

### למה זה עובד
- המדיניות מבוססת **אך ורק** על `auth.uid()`.
- אין תלות באימייל/זהות חיצונית לצורך הרשאות.

### דרישות
זה עובד **רק** אם אתה משתמש ב־**Custom JWT Federation**:
- ה־JWT שנשלח ל־Supabase חייב לכלול `sub` שהוא UUID.
- ב־template הזה ה־Edge Function `clerk-jwt-verify` מייצר UUID דטרמיניסטי מה־Clerk user id (ולכן `auth.uid()` יציב).

### מה נוצר
- `public.profiles`:
  - `id uuid default auth.uid()`
  - RLS מלא (select/insert/update/delete) למשתמש עצמו
- `public.projects`:
  - `user_id uuid default auth.uid()`
  - אינדקס על `user_id`
  - RLS מלא (select/insert/update/delete) למשתמש עצמו

