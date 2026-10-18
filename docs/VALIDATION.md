# Vérification de la livraison

## Exécuté dans l'environnement de préparation

| Contrôle | Résultat | Preuve |
|---|---|---|
| Tests Python de calcul, géométrie, scanner, journal et API | **39 réussis** | `verification/python-tests.txt` |
| Serveur Uvicorn réel, HTTP et deux connexions WebSocket locales | **Réussi** | `verification/api-websocket-smoke.json` |
| Conservation de masse pendant une coupure puis rattrapage | **Réussi** | Tests Python et test serveur local |
| Sélection partielle, partition exacte et export CSV | **Réussi** | Tests Python et test serveur local |
| Correction sans écrasement du brut | **Réussi** | Tests Python et test serveur local |
| Analyse syntaxique de 17 fichiers TS/TSX | **Aucune erreur de syntaxe** | `verification/typescript-syntax.txt` |
| Typage strict des deux modules sans dépendance : `lib/types.ts`, `lib/api.ts` | **Réussi** | TypeScript local 5.8.3 |
| Analyse syntaxique des trois fichiers YAML | **Réussie** | Lecture PyYAML ; pas une validation par Docker Compose |

L'environnement réellement utilisé est consigné dans `verification/environment.json`. Python y est en version 3.13.5 ; l'image proposée utilise Python 3.12. Les paquets Python testés ont les versions fixées dans les requirements. La compatibilité de **l'image complète Python 3.12** doit encore être confirmée par construction Docker.

Le test serveur local démarre un processus Uvicorn temporaire, avec une nouvelle acquisition et un vrai WebSocket sur loopback. Il n'utilise pas les captures d'écran comme preuve de fonctionnement. Les 315 tonnes observées dans le journal de recette livré correspondent à 21 acquisitions à 15 tonnes, dans cette exécution précise ; ce n'est pas une donnée de stock réelle.

## Non exécuté / non vérifié

**Construction Next.js, typage complet incluant React/Three.js, `docker compose up`, tests Playwright et chargement réel de tuiles externes.** Docker n'est pas disponible dans l'environnement de préparation et les accès réseau depuis le runtime n'ont pas permis d'installer les dépendances frontend.

L'analyse syntaxique ne détecte pas tous les problèmes de typage, de dépendances, de WebGL ou de comportement navigateur. Aucun screenshot du frontend exécuté n'est fourni comme preuve, et aucune inspection visuelle complète de l'application exécutée n'est revendiquée.

Le manifeste cartographique, ses repères et ses bornes ont été testés mathématiquement, y compris à l'antiméridien et en latitude élevée. Cela ne vérifie ni la disponibilité du fournisseur, ni ses droits d'usage, ni l'adéquation de l'image à votre site.

Aucun `package-lock.json` n'a été inventé. La résolution des versions transitives et le premier verrouillage npm doivent être réalisés sur une machine disposant d'un accès registre.

## Commandes pour terminer la recette

Depuis la racine du projet :

```bash
cp .env.example .env
docker compose config --quiet
docker compose up --build -d --wait

docker build --target test -t parc-backend-test ./backend
docker run --rm parc-backend-test
```

Le Dockerfile frontend exige le typage et la construction Next.js avant de produire l'image d'exécution. Une erreur interrompt donc la construction, plutôt que de laisser une image prétendument prête.

Pour la recette navigateur, sur une machine avec Node 22 :

```bash
cd frontend
npm install
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Ces tests créent une session vide dans l'application de recette. La validation visuelle manuelle reste nécessaire pour les détails d'implantation, le matériel graphique et les dimensions du stacker. Voir `RECETTE.md`.

Pour réexécuter seulement le contrôle serveur local, avec les dépendances Python installées :

```bash
python scripts/smoke_live.py
```

La configuration CI fournie prévoit tests Python, construction Docker et Playwright sur une machine disposant du réseau. **La présence de cette CI ne signifie pas qu'elle a déjà été exécutée.**
