# Quickstart — valider la synchronisation Read AI

## 1. Prérequis hors code

1. **Read AI**
   - Le workspace Mosaic est sur un plan Pro ou supérieur, et l'email de l'admin est vérifié.
   - Un admin crée le **webhook de workspace** (Integrations → Workspace → Webhooks) vers
     `https://<domaine de prod>/api/readai/webhook`, déclencheur `meeting_end` (cocher
     `meeting_start` est inutile : il est ignoré).
   - Il copie la clé de signature dans `READAI_WEBHOOK_SECRET`.
   - Il teste avec « Send test request » (attendu : 200, puis rien dans Notion — le payload
     de test n'a que des participants fictifs inconnus, il part donc en « À valider »), puis par
     l'envoi manuel d'un vrai rapport (menu de distribution → webhooks).
2. **Vercel** : ajouter l'intégration Upstash (Marketplace) au projet. Elle injecte
   `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_*`).
3. **Gmail** : sur le compte expéditeur, activer la validation en deux étapes, créer un mot de
   passe d'application → `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM`.
4. **Web Push** : `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, et la même clé publique dans `VITE_VAPID_PUBLIC_KEY` ;
   `VAPID_SUBJECT=mailto:…`.
5. **Sessions** : `openssl rand -base64 32` → `SESSION_SECRET`.
6. **Notion** : ajouter l'option `ReadAI` au select `Source` de Notes si elle n'existe pas.
   Puis :

   ```bash
   npm run check:readai
   ```

   Attendu : chaque ligne `ok`. Une ligne `ÉCHEC` bloque le déploiement.

## 2. Vérifications automatisables

```bash
npm run typecheck     # dont moduleResolution nodenext sur functions/ et api/
npm run check:api     # les 11 routes démarrent sous Node
npm run test:readai   # filtrage, rapprochement, signature, blocs, horodatage
npm run build && grep -rE "ntn_|SESSION_SECRET|VAPID_PRIVATE|SMTP_APP_PASSWORD|KV_REST_API_TOKEN|READAI_WEBHOOK_SECRET" dist/ ; echo "rien = conforme au principe I"
```

Signature, sans Read AI :

```bash
BODY='{"trigger":"meeting_start","request_id":"t1"}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',Buffer.from(process.env.READAI_WEBHOOK_SECRET,'base64')).update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -o /dev/null -w "%{http_code}\n" -X POST $URL/api/readai/webhook -H "X-Read-Signature: $SIG" -d "$BODY"   # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST $URL/api/readai/webhook -H "X-Read-Signature: 00" -d "$BODY"    # 401
```

Sans session :

```bash
for r in "GET /api/contacts" "GET /api/companies" "POST /api/notes" "POST /api/files" "GET /api/readai/items" "POST /api/session"; do
  set -- $r; curl -s -o /dev/null -w "$1 $2 %{http_code}\n" -X $1 $URL$2 -H "x-user-email: theo@gouman.fr"
done   # 401 partout
```

## 3. Grille de convergence (brief §15)

À dérouler dans cet ordre ; chaque ligne renvoie au scénario de `spec.md`.

| Bloc | Vérification | Spec |
| --- | --- | --- |
| Webhook | 401 sans signature ; 200 en < 2 s pour une réunion d'une heure | US1, SC-001 |
| Webhook | même `request_id` deux fois → un seul traitement | US1-5 |
| Webhook | `meeting_start` → 200 sans effet | US1-6 |
| Filtrage | réunion interne → rien | US1-3 |
| Filtrage | externes sans email ou exclus → rien | US1-4 |
| Filtrage | tous reconnus → note, auteurs, notification « ajoutée » | US1-1 |
| Filtrage | un connu + un inconnu → rien dans Notion, file d'attente, puis note avec les deux | US2-1 |
| Rapprochement | `arsene@gouman.fr` → société de Théo présélectionnée | US2-2 |
| Rapprochement | `@gmail.com` inconnu → aucune suggestion | US2-3 |
| Rapprochement | domaine sur deux sociétés → les deux | US2-4 |
| Décisions | rattacher → adresse ajoutée, appel suivant direct | US2-5 |
| Décisions | pas nécessaire → appel suivant sans question | US2-7 |
| Décisions | ignorer → rien, personne exclu | US2-8 |
| Décisions | tout « pas nécessaire », aucun contact → aucune note | US2-9 |
| Décisions | après la note, l'appel n'existe plus dans Redis (`readai:item:<id>`) | US2-10 |
| Dédoublonnage | deux rapports, même seconde → une note ou un élément, deux auteurs | US4 |
| Concurrence | deux validations simultanées → un seul contact | FR-025 |
| Contenu | transcription d'une heure entière et ordonnée | US1-2 |
| Reprise | Notion coupé → erreur ; « Réessayer » → une note, aucun contact recréé | US6 |
| Auth | sans session → 401 partout, `x-user-email` seul ne suffit pas | US3 |
| Auth | 5 codes faux → bloqué ; expiré → refusé ; adresse hors liste → même réponse | US3-2 à 4 |
| Auth | session conservée après fermeture de la PWA installée sur iPhone | US3-6 |
| Notifications | arrive sur iPhone, clic vers la bonne destination | US5 |
| Conformité | aucun secret dans `dist/` ; aucun contenu ni email dans les logs Vercel | I, VIII |
| Non-régression | dictée depuis la PWA installée après connexion par code | US3-8 |
| Non-régression | complément Outlook : classer un mail | SC-008 |
| Non-régression | en-têtes COOP / COEP présents sur `/` | — |

Réunion d'une heure sans Read AI : `node scripts/readai-sample.mjs --minutes 60` produit un
payload signé (participants à fournir) à poster sur le webhook.
