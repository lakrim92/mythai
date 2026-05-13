# TODO — My Thai Street Food (mythai)

## Stack
- Serveur : Node.js/Express — port `3006`
- PM2 : process `mythai`
- Stripe : compte partagé avec Panuozzo — `metadata.source = "site_mythai"`
- Domaine : mythai.fr (à configurer)

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
- [x] **Google Search Console** — propriété vérifiée, sitemap soumis, indexation demandée
- [x] **Google Business Profile** — fiche créée

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
- [x] Vhost `mythai.fr` créé dans `/etc/nginx/sites-available/` (prêt, en attente DNS)
- [x] DNS `A` + `www` pointés vers `88.167.40.86`
- [x] SSL Let's Encrypt actif sur `mythai.fr` et `www.mythai.fr`
- [x] `SITE_URL=https://mythai.fr` dans `.env` (déjà correct)
- [x] `canonical` + Schema.org déjà sur `mythai.fr`

---

## 🔴 À corriger — INCIDENTS DU 04/05/2026

> Incidents survenus ce soir : serveur down, commande perdue, mails non envoyés, tablette aveugle.

> ⏰ **Quand effectuer ces corrections ?**
> - **Fix A** : à tout moment, sans impact
> - **Fix B, C, D** : uniquement **après 23h00 ou avant 11h00** (restaurant fermé) — ces fixes nécessitent un `pm2 reload` qui coupe brièvement les connexions SSE de la tablette

### A. `pm2 startup` + `pm2 save` — PRIORITÉ CRITIQUE ✅
- [x] `pm2 startup systemd` configuré — service `pm2-lakrim.service` actif
- [x] `pm2 save` fait — tous les process sauvegardés

### B. Writes atomiques pour `orders.json` — PRIORITÉ CRITIQUE ✅
- [x] `atomicWrite()` (write `.tmp` → rename) dans **mythai/server.js** pour orders, pending_items, promo_used
- [x] `loadFile()` loggue un warning si fichier corrompu (sans écraser)
- Note : woodiz/panuozzo à faire séparément

### C. Réconciliation Stripe au démarrage — PRIORITÉ IMPORTANTE ✅
- [x] `reconcileStripeOrders()` au boot — compare sessions payées des 2 dernières heures avec orders.json
- [x] Testé : doublon détecté correctement, commande manquante traitée
- Note : woodiz/panuozzo à faire séparément

### D. Token woodiz→mythai : API key statique — PRIORITÉ MOYENNE ✅
- [x] `MYTHAI_INTERNAL_API_KEY` dans les deux `.env`
- [x] mythai : `tabletteAuth` + `adminAuth` acceptent `x-internal-api-key`
- [x] woodiz : `getMythaiToken()` supprimé, remplacé par `getMythaiInternalHeader()` statique
- [x] Testé : 200 avec clé, 401 sans clé

---

## 🟢 Améliorations futures (optionnel)

### Imprimante thermique — État & procédure

**État actuel (05/05/2026) :**
- `printserver.js` existe dans Termux sur la tablette (`~/printserver.js`)
- Imprimante : `192.168.1.130:9100` (réseau local restaurant)
- Test shell fonctionne : `curl -s https://www.panuozzo-bougival.fr/test-print.sh | sh` → imprime ✅
- Impression depuis l'UI tablette → "Erreur réseau" ❌
- `tablette.js` : fix reconnexion SSE déployé (impression auto sur init + suivi `_printed_ids`)

**Cause probable "Erreur réseau" depuis le navigateur :**
- La page tablette est servie en HTTPS (`https://www.panuozzo-bougival.fr`)
- Le navigateur bloque `fetch('http://localhost:19099')` (mixed content HTTPS→HTTP)
- Chromium/Android impose cette restriction même pour localhost

**Pour corriger (à faire) :**
- [ ] Servir le printserver en HTTPS avec certificat auto-signé, OU
- [ ] Passer le printserver sur WebSocket (plus compatible navigateur), OU
- [ ] Utiliser `chrome://flags/#block-insecure-private-network-requests` (désactiver temporairement sur la tablette pour tester)
- [ ] Une fois la cause confirmée : implémenter la solution retenue dans `printserver.js`

**Démarrage manuel (Termux) :**
```sh
pkill -f printserver.js; node ~/printserver.js &
```
(le `pkill` évite EADDRINUSE si une instance tourne déjà)

**À faire aussi :**
- [ ] Auto-démarrage au boot de la tablette (Termux:Boot + script de démarrage)
- [ ] PWA tablette dédiée My Thai (ou mutualisation avec tablette Panuozzo — voir TODO-MULTI-RESTAURANT.md)
- [ ] Pages SEO locales par zone de livraison

### Avis Google (en attente compte Google)
- [x] Endpoint `/api/reviews` — filtre ≥ 4 étoiles, 3 plus récents, cache 6h (retourne `[]` sans clés)
- [x] Section `#avis` dans `index.html` — masquée, s'affiche automatiquement au 1er avis valide
- [x] Avis en dur dans `app.js` (Georges Dietrich, Got Hammadi, Mohamed Ali Hajjem) — Places API non utilisée (billing requis)
- [x] `GOOGLE_PLACE_ID=ChIJP3jv12195kcRR22PFgkYH5o` dans `.env`
- [ ] Ajouter Schema.org `AggregateRating` dans `index.html` dès 5+ avis Google

---

## 🔗 Voir aussi

- `~/workspace/woodiz/TODO-MULTI-RESTAURANT.md` — tablette.html + admin.html multi-restaurant
- `~/workspace/woodiz/TODO-SEO.md` — référence SEO Panuozzo (à dupliquer pour My Thai)
