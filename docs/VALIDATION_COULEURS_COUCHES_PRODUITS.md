# Validation — couches et couleurs produit

Vérifications exécutées :

- 68 tests backend Python réussis ;
- scénario A 0–3 m puis B 3–4 m vérifié dans la grille stratigraphique ;
- dépôts consécutifs du même produit fusionnés ;
- géométrie stratifiée : 2 couches, 2 groupes de matériaux, test réussi ;
- 22 fichiers TypeScript/TSX analysés, 0 erreur de syntaxe ;
- `git diff --check` sans erreur.

Le build Docker/Next.js complet doit être exécuté sur le poste de développement :

```bash
docker compose build --no-cache frontend backend
```
