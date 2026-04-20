# TODO — My Thai Street Food (mythai)

## Stack
- Serveur : Node.js/Express — port `3006`
- PM2 : process `mythai`
- Stripe : compte partagé avec Panuozzo — `metadata.source = "site_mythai"`
- Domaine : mythai-bougival.fr (à configurer)

---

## ✅ Fait

- [x] Serveur Express (port 3006) — routes, Stripe checkout, webhook, SSE
- [x] Horaires identiques à Panuozzo (Mar-Dim 11h-15h & 18h-23h, Lundi fermé)
- [x] `FORCE_OPEN` bypass dans `.env` pour tests
- [x] Emails client + admin avec bloc logo My Thai (emailBrandBlock)
- [x] Photo hero (`hero_mythai.jpg`) — curry thaï fond sombre
- [x] Photo ambiance (`ambiance_mythai.jpg`) — street food Bangkok
- [x] Section promo -10% première commande (visible en haut de page)
- [x] Copyright 2026
- [x] Footer — crédit AI-Autoheal
- [x] Favicon : `favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `favicon-512.png`
- [x] OG image (`og-image.jpg` 1200×630) pour Google/réseaux sociaux
- [x] Tags favicon + og:image dans `<head>` de `index.html`

---

## 🔴 À faire — PRIORITÉ HAUTE

### 1. Mentions légales ✅
- [x] Créer page `legal.html` (mentions légales + CGV + cookies + RGPD)
- [x] Contenu : éditeur, hébergeur, directeur de publication
- [x] Lien dans le footer
- [x] SIRET : 988 030 797 00019 — complété dans `legal.html` et reçu
- [x] Responsable de publication : Ahmed Abdellatif — complété

### 2. CGV ✅
- [x] Intégrée dans `legal.html` (section #cgv)
- [x] Modalités commande, paiement, livraison, allergènes, rétractation
- [x] Case à cocher obligatoire dans le tunnel de commande

### 3. Politique de cookies ✅
- [x] Intégrée dans `legal.html` (section #cookies)
- [x] Tableau cookies, opt-in/opt-out, liens navigateurs

### 4. Bandeau cookies (RGPD) ✅
- [x] Bandeau intégré dans `legal.html`
- [x] Bandeau ajouté dans `index.html`

### 5. Zones de livraison ✅
- [x] Zones définies : Bougival, Le Pecq, Louveciennes, La Celle-Saint-Cloud, Croissy, Chatou, Marly-le-Roi, Rueil-Malmaison, Saint-Cloud
- [x] Section `#livraison` affichée sur la page (grille 9 communes + CP)
- [x] Vérification côté serveur à la commande (DELIVERY_ZONES dans server.js)
- [x] Lien "Voir les zones" dans la section Horaires & Accès

### 6. Minimum de commande ✅
- [x] Minimum : 12€ à emporter, 20€ livraison (Panuozzo : 20€ flat — My Thai plus souple)
- [x] Ligne info permanente dans le panier ("Minimum à emporter : 12 €")
- [x] Warning rouge + bouton désactivé si total < minimum
- [x] Recalcul automatique au changement de mode

### 7. Lien Google Maps ✅
- [x] Lien Google Maps dans la section Horaires & Accès
- [x] Lien Google Maps dans le footer (adresse + lien dédié)
- [ ] Optionnel : iframe Google Maps intégrée

---

## 🟡 À faire — PRIORITÉ MOYENNE

### 8. SEO & Indexation ✅ (partiel)
- [x] `robots.txt` + `sitemap.xml`
- [x] Schema.org `Restaurant`, `WebSite`, `BreadcrumbList` dans `index.html`
- [x] Open Graph + Twitter Card
- [x] Meta title/description/keywords optimisés
- [ ] **⏳ Google Search Console** — en attente création compte Google
- [ ] **⏳ Google Business Profile** — en attente création compte Google

### 9. Stripe webhook ✅
- [x] Endpoint configuré dans le dashboard Stripe
- [x] `STRIPE_WEBHOOK_SECRET` renseigné dans `.env`

### 10. Reçu fiscal client ✅
- [x] `/api/receipt/:sessionId` — page HTML imprimable, aux couleurs My Thai
- [x] Bouton `📄 Télécharger mon reçu` dans l'email client
- [x] TVA 10%/5.5%, promo, frais livraison, SIRET complet
- [x] `/api/test-email` supprimé

### 11. Nginx + domaine
- [x] Vhost `mythai.ai-autoheal.com` actif (SSL Let's Encrypt) — utilisé pendant la phase de test
- [x] Vhost `mythai-bougival.fr` créé dans `/etc/nginx/sites-available/` (prêt, en attente DNS)
- [ ] **⏳ Quand le domaine `mythai-bougival.fr` est créé** :
  - Pointer DNS `A` + `www` vers l'IP publique du Pi
  - Lancer : `sudo certbot --nginx -d mythai-bougival.fr -d www.mythai-bougival.fr --non-interactive --agree-tos --email jo.choupinou@gmail.com`
  - Mettre à jour `SITE_URL` dans `.env` : `https://mythai-bougival.fr`
  - Mettre à jour `canonical` + Schema.org dans `index.html` si domaine différent de `mythai-bougival.fr`

---

## 🟢 Améliorations futures (optionnel)

- [ ] Imprimante thermique (même config que Panuozzo une fois le matériel branché)
- [ ] PWA tablette dédiée My Thai (ou mutualisation avec tablette Panuozzo — voir TODO-MULTI-RESTAURANT.md)
- [ ] Pages SEO locales par zone de livraison

### Avis Google (en attente compte Google)
- [x] Endpoint `/api/reviews` — filtre ≥ 4 étoiles, 3 plus récents, cache 6h (retourne `[]` sans clés)
- [x] Section `#avis` dans `index.html` — masquée, s'affiche automatiquement au 1er avis valide
- [ ] **⏳ Quand compte Google créé** : ajouter dans `.env` :
  - `GOOGLE_PLACES_API_KEY=<clé>`
  - `GOOGLE_PLACE_ID=<id>` (trouvable via Google Maps → partager → URL)
- [ ] Ajouter Schema.org `AggregateRating` dans `index.html` dès 5+ avis Google

---

## 🔗 Voir aussi

- `~/workspace/woodiz/TODO-MULTI-RESTAURANT.md` — tablette.html + admin.html multi-restaurant
- `~/workspace/woodiz/TODO-SEO.md` — référence SEO Panuozzo (à dupliquer pour My Thai)
