# @renewcorp/shared

Shared UI components and Supabase backend for Renewcorp apps (Outback Explorer, Compass, …).

## What's in here

- `src/feedback/` — React Native `FeedbackAdminScreen` consumed by each app as a git dep
- `supabase/migrations/` — source-of-truth SQL for the feedback schema
- `supabase/functions/send-feedback-email/` — parameterised Edge Function
- `scripts/deploy.ps1` — one-command deploy to every configured Supabase project

## Update workflow — update once, roll out everywhere

### UI changes (React Native)

1. Edit files under `src/` and push to `main`
2. In each consumer project: `npm update @renewcorp/shared` and commit the lockfile

### Backend changes (SQL migrations + Edge Functions)

1. Edit `supabase/migrations/*.sql` or `supabase/functions/send-feedback-email/index.ts`
2. Commit + push to `main`
3. Run the deploy script:
   ```powershell
   pwsh ./scripts/deploy.ps1
   ```
   That pushes SQL to every project and redeploys the Edge Function.

## First-time setup

1. Copy `scripts/projects.ps1.example` to `scripts/projects.ps1` and fill in:
   - Supabase personal access token (https://supabase.com/dashboard/account/tokens)
   - Resend API key (only if you'll use `-SetSecrets`)
   - Each project's `Ref`, `DbUrl`, `AppName`, `FeedbackEmail`
2. First deploy for a new project — also push the Edge Function secrets:
   ```powershell
   pwsh ./scripts/deploy.ps1 -Only "Compass" -SetSecrets
   ```

## Script flags

| Flag | Effect |
|---|---|
| `-Only <Name>` | Deploy to a single project |
| `-SkipDb` | Skip SQL migrations |
| `-SkipFunctions` | Skip Edge Function deploy |
| `-SetSecrets` | Also push `APP_NAME` / `FEEDBACK_TO_EMAIL` / `RESEND_API_KEY` |

## Consumer projects

Each app installs via git dep:
```json
"@renewcorp/shared": "github:RenewCORP/Renewcorp-Shared"
```

And uses the screen as a thin wrapper:
```tsx
import { FeedbackAdminScreen } from '@renewcorp/shared';
import { supabase } from '../src/lib/supabase';
import { useRouter } from 'expo-router';

export default function FeedbackScreen() {
  const router = useRouter();
  return <FeedbackAdminScreen supabase={supabase} onBack={() => router.push('/(tabs)/settings')} />;
}
```
