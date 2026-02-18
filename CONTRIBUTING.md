# Contributing

Thanks for helping improve this foundation.

## Development setup

- **Node**: use the project’s recommended Node LTS.
- Install deps:

```bash
npm install
```

## Running the app

```bash
npx expo start
```

## Supabase / Edge Functions

- Apply migrations:

```bash
supabase db push
```

- Serve functions locally:

```bash
supabase functions serve --no-verify-jwt
```

## Validation

Run the foundation validator (requires Supabase env in `.env`):

```bash
npm run validate
```

## Pull requests

- Keep changes focused and small.
- Don’t include secrets in code, logs, screenshots, or commits.
- Update docs when behavior changes.

