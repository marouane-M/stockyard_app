# Validation v2.1

Contrôles exécutés dans l'environnement de préparation :

- `PYTHONPATH=backend pytest -q backend/tests` : **60 tests réussis**.
- Scénario Python manuel : création d'un job, lancement, dépôts, fin de job,
  reprise depuis journal fichier : **réussi**.
- Analyse syntaxique TS/TSX avec TypeScript global : **20 fichiers, 0 erreur de syntaxe**.

Non exécuté ici : Docker Compose, `next build`, test navigateur complet et
chargement réel des tuiles cartographiques. Docker et les dépendances npm ne
sont pas disponibles dans cet environnement. La vérification complète doit être
faite chez vous avec :

```bash
docker compose up --build
```
