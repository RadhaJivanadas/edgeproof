# Publish EdgeProof to GitHub and Render

## 1. Create the GitHub repository

Open GitHub and create a new **public** repository:

- Owner: `kovyrus`
- Repository name: `edgeproof`
- Visibility: Public
- Do not add a README, `.gitignore`, or license because they are already in the project.

Then ensure the ChatGPT GitHub app is installed for this repository. In GitHub settings, open **Applications → Installed GitHub Apps → Configure**, select `edgeproof`, and save.

## 2. Push from your computer

Extract the supplied ZIP, open a terminal in the `edgeproof` folder, and run:

```bash
git init
git branch -M main
git add .
git commit -m "Launch EdgeProof TxLINE trading agent"
git remote add origin https://github.com/kovyrus/edgeproof.git
git push -u origin main
```

If Git asks for a password, use a GitHub personal access token or sign in through Git Credential Manager; normal account passwords are not accepted for Git pushes.

## 3. Deploy to Render

After the repository is public and pushed, open:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kovyrus/edgeproof
```

Then:

1. Connect GitHub if prompted.
2. Confirm the service name `edgeproof`.
3. Click **Apply**.
4. Wait until the deploy status is **Live**.
5. Open `/api/health` and confirm `ok: true`.

The public deployment intentionally starts in judge replay mode and needs no secrets.

## 4. Optional live service

Create a second Render web service from the same repository, or temporarily change the first service:

- `DATA_MODE=txline`
- `TXLINE_BASE_URL=https://txline.txodds.com`
- `TXLINE_API_TOKEN=<secret>`
- `TXLINE_FIXTURE_ID=<covered fixture>`
- `HOME_TEAM`, `AWAY_TEAM`, `COMPETITION_NAME`

Keep `TXLINE_API_TOKEN` as a Render secret. Never commit it.

For competition reliability, use the replay deployment as the primary submitted URL and the live service only for evidence/video.
