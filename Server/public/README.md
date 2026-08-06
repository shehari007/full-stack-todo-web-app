# Intentionally empty

Vercel requires an output directory for a project it does not recognise as a
framework, and it publishes everything in that directory as static files at the
site root.

This directory is that output directory, and it is empty on purpose.

It used to be `dist/`, which meant every compiled server file was fetchable:
`/config/env.js`, `/db/seed.js` and the rest of the API's source, served to
anyone who asked. Pointing Vercel at an empty directory instead means the only
thing reachable is the function in `api/`, which is the whole point of the
deployment.

Do not put anything here that should not be public.
