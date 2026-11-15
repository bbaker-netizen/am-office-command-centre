# Changes 2026-11-15: master admin

Phone version am-inv-v83.

A new level above admin, for Bruce only (Bruce, 15 November).

## Who it is

The master admin is named in Netlify, not in the app: **MASTER_ADMINS**, a comma-separated list of email addresses. The person also has to be an active admin. Because it lives in Netlify, nobody can make themselves master from People and access.

## What only the master admin can do

- **See another person's mail while viewing as them.** It stays look only: no drafting, ticking or sending in their name.
- **Change, reset, invite, switch off or remove the master admin's account.** Admins, Craig included, get "That is the master admin's account. Only the master admin can change it."
- **View as the master admin.** That account does not appear in an admin's View as list, and the server refuses it.

## What changed for admins

Admins (Craig, Amir) keep View as. They see the person's sections, pages and list, but **not their mail**: "Their mail stays private. Only the master admin can see another person's mail." This replaces this morning's change, where any admin could see mail.

## Shown

People and access shows "Master admin" against that account, and explains the level under "What each level can do".

## To switch it on

In Netlify, Site configuration, Environment variables, add MASTER_ADMINS with Bruce's command centre email address, then deploy. Until it is set there is no master admin, and nobody can see anyone else's mail.

## Files

netlify/functions/_accounts.mjs (isMaster), account.mjs, assistant.mjs, command.mjs; public/command.html, public/sw.js; test/master-admin.test.mjs (new, 3 checks), test/assistant.test.mjs (updated).
