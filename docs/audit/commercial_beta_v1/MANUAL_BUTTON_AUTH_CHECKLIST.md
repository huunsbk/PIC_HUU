# Commercial Beta V1 Manual Button/Auth Checklist

Environment: GitHub Pages / Commercial Beta V1

Target app URL: `https://huunsbk.github.io/PIC_HUU/`

Do not use real passwords in this document. Use only a dedicated demo account approved for testing.

## Authentication

- [ ] Login with admin demo account succeeds.
- [ ] Wrong password shows an error and does not log the user in.
- [ ] Missing email/username shows validation feedback and does not submit.
- [ ] Missing password shows validation feedback and does not submit.
- [ ] After successful login, redirect keeps `/PIC_HUU/` in the URL.
- [ ] After successful login, URL format is `https://huunsbk.github.io/PIC_HUU/#/<tenant_or_tournament_id>`.

## Routing

- [ ] Dashboard loads the correct tournament/workspace after login.
- [ ] Browser refresh on the authenticated dashboard preserves the correct tournament/workspace.
- [ ] Open tournament action keeps `/PIC_HUU/` in the generated URL.
- [ ] Open event action keeps `/PIC_HUU/` in the generated URL.

## Buttons

- [ ] Team create button is visible only for permitted roles.
- [ ] Team edit button is visible only for permitted roles.
- [ ] Team delete button is visible only for permitted roles.
- [ ] Group create/setup buttons are visible only for permitted roles.
- [ ] Group edit/move buttons are visible only for permitted roles.
- [ ] Match schedule/regenerate buttons are visible only for permitted roles.
- [ ] Match reset/cancel buttons are visible only for permitted roles.
- [ ] Score save button is visible and enabled for roles with score-entry permission.
- [ ] Score save button is hidden or disabled for roles without score-entry permission.
- [ ] Permission-based hidden buttons do not appear for unauthorized roles.

## Logout

- [ ] Logout button exists for authenticated admin users.
- [ ] Logout clears authenticated UI state.
- [ ] Refresh after logout stays logged out.
- [ ] Browser back button after logout does not restore authenticated controls.
- [ ] Browser back button after logout does not expose restricted tournament/admin actions.

## Evidence

- [ ] Record tested account type, without password.
- [ ] Record browser and device used.
- [ ] Capture screenshots for login success, permission-restricted UI, logout, and back-button behavior.
- [ ] Record any console or network errors observed during manual testing.
