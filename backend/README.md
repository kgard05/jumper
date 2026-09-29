# Guitar benchmark results

The student test and teacher dashboard are static files served by GitHub Pages. Cloudflare Worker `gardner-benchmark-api` serves `https://api.gardnerclassroom.com/api/`, with the private D1 database `gardner-benchmark-results` bound as `DB`.

Students submit their names and answers without an account. The server validates and grades the original 70-point knowledge assessment. A receipt UUID makes retries safe. Playing scores (30 points) and feedback can only be read or changed through authenticated teacher requests.

## Teacher setup

In the Worker's Settings → Runtime variables and secrets, add a **Secret** named `TEACHER_PASSWORD`, with a unique passphrase of at least 12 characters (maximum 200). Keep its value out of this repository. Teacher login is at `/guitar/benchmark/teacher/` on Gardner Classroom. Sessions expire after eight hours; signing out invalidates the session. Teacher data is never included in the public site's files.

## Updates

Use the Cloudflare editor to deploy `worker.mjs`, or run `npx wrangler deploy` from this directory with your Cloudflare account. Preserve the `DB` binding and teacher secret. `wrangler.jsonc` contains the current nonsecret deployment configuration. Tables and indexes are initialized automatically on first database request.

The health endpoint reports whether the database and teacher secret are configured; it reveals no credentials or student information. The teacher API requires a secure HTTP-only session cookie. CORS is restricted to the classroom domain, and writes require its Origin header. Password guessing and submission bursts are limited per IP.

## Scoring

Knowledge: open strings 6, symbols 8, chord identification 24, chord building 16, playing knowledge 8, application 8. Building gives one point for the complete open/muted pattern and one for each of the three correct fretted notes. G also accepts `3 2 O O 3 3` for full credit. The teacher rubric totals 30. A student's overall score remains pending until all playing items are scored.

Export CSV from the teacher dashboard to download names, dates, knowledge/playing/overall scores, rubric values, feedback, receipts, and all answers. CSV values beginning with spreadsheet formula characters are escaped.
