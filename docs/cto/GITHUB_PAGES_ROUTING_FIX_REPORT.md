# GitHub Pages Routing Fix Report

## Cause

GitHub Pages serves static files and does not rewrite nested browser routes to `index.html`. Directly opening `/PIC_HUU/admin/workspace/thang-oanh` made GitHub Pages look for a physical file at that path and return `404 Not Found`.

## Files Updated

- `.github/workflows/deploy.yml`
- `package.json`
- `scripts/copy-spa-fallback.mjs`

## Fix

- Keep BrowserRouter and clean routes.
- Keep Vite base as `/PIC_HUU/`.
- Copy `dist/index.html` to `dist/404.html` after build so GitHub Pages can serve the SPA fallback for nested routes.
- Also copy `dist/index.html` to known pretty-route fallback files:
  - `dist/admin/workspace/thang-oanh/index.html`
  - `dist/tournament/thang-oanh/index.html`

Note: after deploy run `#132`, `/PIC_HUU/404.html` existed, but direct `/PIC_HUU/admin/workspace/thang-oanh` still returned an empty GitHub Pages 404 response. The physical pretty-route fallback was added to make the required demo route work reliably on project Pages hosting.

## Local Verification

- `npm.cmd run build`: PASS.
- `npm.cmd run lint`: PASS.
- `dist/index.html`: exists.
- `dist/404.html`: exists.
- `dist/404.html` JS asset path: `/PIC_HUU/assets/index-BMW3qZ6w.js`.
- `dist/404.html` CSS asset path: `/PIC_HUU/assets/index-DoU9ZdX_.css`.
- `dist/admin/workspace/thang-oanh/index.html`: exists.
- `dist/tournament/thang-oanh/index.html`: exists.
- Pretty-route fallback JS/CSS asset paths: `/PIC_HUU/assets/...`.

## Production Verification

- Deploy run `#132`: PASS, but direct route still returned empty 404 before physical route fallback.
- Pending redeploy with physical pretty-route fallback.
