# Auth setup — Google and Apple

The code is done. What is left is console configuration, which cannot be done
from the repo. This is the checklist.

Project ref: **`sbwjfjphumqhdmmanimb`**
Provider callback URL (the one Google and Apple need):

```
https://sbwjfjphumqhdmmanimb.supabase.co/auth/v1/callback
```

---

## Why a button can look broken when nothing is broken

Three different URLs are involved and they are easy to confuse:

| URL | Who needs it | What it is |
|---|---|---|
| `https://<ref>.supabase.co/auth/v1/callback` | **Google / Apple consoles** | where the provider returns to Supabase |
| `truckkoo://` | **Supabase → URL Configuration** | where Supabase returns to a dev/production build |
| `exp://192.168.1.11:8081` | **Supabase → URL Configuration** | where Supabase returns to **Expo Go** |

Miss the third and the flow works everywhere except the way you are most likely
testing it. The browser opens, you sign in, and the hand-back is silently
dropped — which is indistinguishable from "the button does nothing".

The app logs the redirect it will actually use; `authRedirectUri()` in
`src/lib/auth.ts` returns it if you need to check.

**The `exp://` host is your LAN IP and it changes.** If you move network or your
router reassigns, re-run `hostname -I` and add the new one. This is the single
most common cause of "it worked yesterday".

---

## 1. Google (do this first — it is the one you can test on Android)

**Google Cloud Console** → APIs & Services → Credentials:

1. Configure the OAuth consent screen if you have not. External, and while it is
   in *Testing* only accounts you add as test users can sign in — add your own.
2. Create credentials → **OAuth client ID** → **Web application**.
   - Not "Android", not "iOS". Supabase's browser flow is a *web* client, and
     picking the Android type here is a common dead end.
   - Authorised redirect URI: `https://sbwjfjphumqhdmmanimb.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret**.

**Supabase dashboard** → Authentication → Providers → Google:

4. Enable, paste the client ID and secret, save.

**Supabase dashboard** → Authentication → URL Configuration → Redirect URLs, add:

```
truckkoo://
truckkoo://*
exp://192.168.1.11:8081
exp://192.168.1.11:8081/--/*
```

Then: `npx expo start`, open in Expo Go, tap **Continue with Google**.

---

## 2. Apple (only needed for the iOS build)

On iOS the app uses **native** Sign in with Apple (`expo-apple-authentication`)
and exchanges the identity token directly, so there is no redirect URI and
nothing to allow-list. The button is hidden on Android — Apple only requires it
on Apple platforms.

**Apple Developer** → Certificates, Identifiers & Profiles:

1. On the App ID `com.truckkoo.app`, enable the **Sign in with Apple**
   capability. `app.json` already sets `ios.usesAppleSignIn`, so the entitlement
   is in the build.
2. Create a **Services ID** and a **Key** for Sign in with Apple, and note the
   Team ID, Key ID and the `.p8` key.

**Supabase dashboard** → Authentication → Providers → Apple:

3. Enable. For the native flow, the important field is the **Client IDs** list —
   it must contain the bundle identifier `com.truckkoo.app`, or Supabase rejects
   the identity token as being for an unknown audience.

Native Apple sign-in cannot be tested on Linux; it needs a real iOS device or an
EAS build.

---

## 3. What happens after a successful sign-in

The user has a session but no `profiles` row, so the gate in
`src/app/_layout.tsx` sends them to `/sign-up`, which derives its step from
session state and starts at **role selection** rather than asking for an email
again. Role is written once and cannot be changed afterwards.

That path already works and is what P2 will replace when phone sign-in lands.

---

## Troubleshooting

**"Continue with Google" shows an error immediately** — the provider is off in
the Supabase dashboard. The app deliberately says so rather than "something went
wrong", because that one is actionable.

**The browser opens, you sign in, and land back on the sign-in screen** — the
redirect URL is not allow-listed. Check the `exp://` entry matches your current
LAN IP.

**`redirect_uri_mismatch` from Google** — the *Google console* redirect URI is
wrong. It must be the `supabase.co/auth/v1/callback` URL, not `truckkoo://`.

**Apple: "invalid_client"** — the bundle ID is missing from the Client IDs list
in the Supabase Apple provider settings.

**It works in a dev build but not Expo Go** — expected for anything native, but
Google here is a browser flow and should work in both. If it does not, it is the
`exp://` redirect again.
