# Google auth runtime review scope

Deze tijdelijke reviewnotitie beschrijft wat vóór merge van de runtime-refactor gecontroleerd moet zijn:

- Eén Google-auth runtime in het production startscript; de twee oude preloads zijn verwijderd.
- Sessie-Map koppeling is fail-fast en onafhankelijk van de volgorde van andere Maps.
- OAuth state, nonce-cookie en OIDC nonce zijn aan dezelfde loginpoging gebonden.
- Google ID-token wordt cryptografisch tegen Google JWKS gevalideerd, inclusief issuer, audience, authorized party, expiry, issue time, verified email, hosted domain en stable sub.
- Een geverifieerde Google sub kan niet via e-mailhergebruik of een nieuw koppelverzoek worden overschreven.
- Prelinked e-mail zonder sub blijft eerste verificatie ondersteunen.
- Afgewezen/vervangen koppelverzoeken kunnen een latere goedkeuring niet overschrijven.
- Google callback tot en met persistente sessie en /api/me wordt als integratietest uitgevoerd.
- De bestaande password-login, remember-me, CSRF bescherming en sessie-revocation uit PR #227 blijven werken.

Dit bestand wordt vóór merge weer verwijderd; de inhoud hoort uiteindelijk in de PR-beschrijving en tests, niet als productiebestand.
