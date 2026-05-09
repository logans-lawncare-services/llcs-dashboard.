# LLCS modular dashboard

Static site: `index.html`, `css/styles.css`, `js/app.js`. Data lives in **localStorage** under keys prefixed with `llcs_*_v4`.

## GitHub Pages

1. Create a repository (example: `llcs-dashboard`).
2. Upload this folder at the repo root **or** inside `docs/` (match step 5).
3. On GitHub open **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Select **main** (or **master**) and folder **`/ (root)`** or **`/docs`**, matching where you put the files.
6. Save. A project site is usually `https://<user>.github.io/<repo>/`.

Keep the folder layout so relative paths work: `css/styles.css` and `js/app.js`.

## Backup

- Use **Admin → Download full backup (JSON)**. The file includes jobs, expenses, customers, permissions, and audit (`llcsDashboard: true`).
- Import that file with **Merge** or **Replace**.

## Migrate from the original single-file dashboard

- **Same browser**: open the original dashboard once so `bd_jobs`, `bd_expenses`, etc. are in localStorage, then use **Admin → Import from legacy localStorage (bd_*)**.
- **Or** export **all data (JSON)** from the original app (`jobs`, `expenses`, `users`, `meta`) and import that file here.

Legacy **users** are not copied into this app; the import only records how many users were present in the audit log.
