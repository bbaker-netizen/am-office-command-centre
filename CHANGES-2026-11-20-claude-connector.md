# Changes 2026-11-20: each person's own Claude connects to the command centre (am-inv-v94)

Asked for by Craig, 20 November 2026: "each person's Claude to be able to connect through MCP to the command center so the employee's Claude can do things automatically for people."

## What it is
- The command centre is now a custom connector (a remote MCP server) at https://am-office-command-centre.netlify.app/mcp.
- Each person adds that address to their own Claude, then signs in once on A&M's own page with their command centre email and password. Claude then works in the command centre as that person, and only as that person.
- Only people with "Can ask Claude" ticked on People and access can connect.

## What their Claude can do
Nine tools, each calling the command centre's own endpoints as the person, so it sees and does exactly what they can on their own screen:
- who_am_i
- find_jobs, get_job, estimating_board (read)
- take_estimate, let_go_of_estimate (the "taken by" from v93; take_over only when the person asked)
- my_day (their hit list, emails that need them, today's meetings), add_to_my_list, tick_off_my_list

It cannot send email, pay anyone, or change JobTread fields. More tools can be added one at a time.

## How access is controlled
- OAuth 2.1, the way Claude's connectors expect: protected resource and authorization server metadata, self-registration (RFC 7591), PKCE S256, one-hour access tokens, refresh tokens rotated on every use.
- Only Claude's own return addresses are accepted: claude.ai and claude.com for the apps, and a loopback address for Claude Code.
- The sign-in uses the command centre's own password check, so the same wrong-try lockouts apply.
- Every request checks the account: switched off, "Can ask Claude" unticked, or password changed, and it stops on the next request.
- Each person sees their connections under My account, Your own Claude, with Disconnect, which ends it at once.
- The token Claude holds opens nothing else: not the command centre's own pages, not the shop.

## Files
- netlify/functions/mcp.mjs (new): /mcp, /.well-known/oauth-protected-resource[/mcp], /.well-known/oauth-authorization-server, /oauth/register, /oauth/authorize, /oauth/token, /oauth/revoke, /api/claude-connections
- netlify/functions/_mcpauth.mjs (new): the sign-in rules
- public/command.html: My account, Your own Claude; People and access wording on Can ask Claude
- test/mcp.test.mjs (new, 18 checks)

## Setting it up (after merge)
- Team or Enterprise Claude plan: an Owner adds it once for the organization, under Customize, Connectors, Add, Custom, then Web, with the address above and nothing under advanced settings. Everyone then connects with their own sign-in.
- Pro or Max: each person adds it under Customize, Connectors, Add custom connector.
- Tick "Can ask Claude" for each person who should have it.

## Tested
- All 22 test files pass. The Claude connector test goes end to end through the real endpoints with a stand-in JobTread: discovery, registration, the sign-in page, a wrong password, an account without Can ask Claude, Cancel, PKCE, code reuse, all nine tools, refresh rotation, untick, Disconnect, expiry, password change.
- Not yet tried from a real Claude account against the live site.
