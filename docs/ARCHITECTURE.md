# Architecture de la version 0.2

## Deux services applicatifs

```text
Navigateur
  UI Next.js / scène Three.js
  ├── GET /api/runtime → frontend (configuration publique d'exécution)
  └── HTTP / WebSocket → central Python
                         ├── simulation acquisition / pose / scan
                         ├── journal durable local et acceptations
                         ├── calcul de matière / corrections / relecture
                         └── fournisseur d'imagerie HTTPS configuré
```

Le serveur Next.js sert l'application et sa configuration publique. La simulation et tous les calculs métier sont dans le backend. Le WebSocket n'avance pas l'horloge ; ouvrir deux onglets ne double pas les dépôts.

L'acquisition est une tâche unique de 10 Hz. Les fréquences de scanner autorisées vont de 1 à 10 Hz, quantifiées sur cette horloge. L'envoi navigateur est limité à 5 Hz, avec une interpolation visuelle des poses. L'accélération du temps affecte déplacement et quantité déposée, pas l'identité de la séquence ni le timestamp UTC d'acquisition. Sous forte charge, cette simulation à pas fixe peut ralentir par rapport au temps mural ; ce n'est pas une horloge PLC temps réel.

## Hiérarchie géométrique

```text
Repère du parc (X longitudinal, Y latéral, Z vertical)
  └── Base mobile / translation X
      └── Orientation / rotation Z, pivot à la hauteur configurée
          └── Inclinaison / rotation −Y
              ├── Flèche et convoyeur
              └── Montage scanner
                  └── Rotation X → Rotation Y → Rotation Z du montage
                      └── Scanner, plan de balayage, rayon animé
```

La racine Three.js effectue une seule conversion `(x, y, z) → (x, z, −y)`. Le backend conserve toutes les mesures dans le repère industriel. Les points mondiaux transmis sont déjà transformés. Le scanner n'est jamais placé indépendamment en coordonnées globales.

Le mouvement interpolé et la matière qui tombe dans la scène sont des aides d'affichage. La grille et le journal ne sont jamais alimentés par des positions interpolées dans le navigateur.

## Données et calcul spatial

Chaque acquisition contient : identité `{instance}-{séquence}`, horodatage réel, temps simulé, pose, configuration de machine et de scanner, version de configuration, mesures 2D éventuelles, empreinte de dépôt et lot. Une empreinte est une répartition gaussienne tronquée, renormalisée sur le parc autorisé. La somme des volumes reste égale à la masse simulée divisée par la densité archivée.

Pour une sélection rectangulaire R et une cellule C :

```text
fraction(C, R) = aire(C ∩ R) / aire(C)
volume(R, produit) = Σ dépôts, cellules [volume_cellule × fraction]
masse(R, produit)  = Σ dépôts, cellules [volume_cellule × fraction × densité_du_dépôt]
```

Les analyses sont moyennées par masse, pas par nombre de rayons. Le calcul coupe les cellules exactement en aire, mais ne prétend pas connaître la distribution à l'intérieur des cellules de 2 m.

## Acquisition, continuité et garde

Les rôles d'acquisition et de central sont simulés dans un même backend. Avant qu'un record ne soit intégré au central, son acquisition est écrite et synchronisée sur disque. Une acceptation est également persistée avant l'intégration. La déduplication porte sur les identités et le contexte de session.

En coupure, les records continuent à être journalisés, mais ne sont pas acceptés. À la restauration, le direct est accepté en priorité et deux records de rattrapage sont traités par tick. Les acquisitions manquantes sont des identifiants explicites. Les mesures de surface utilisent un ordre par séquence afin qu'un vieux retour en rattrapage n'écrase pas une mesure plus récente.

L'acquisition est arrêtée et une alarme apparaît en cas d'échec d'écriture. Une fin de fichier tronquée après un arrêt brutal est archivée dans un fichier `.incomplete` avant reprise ; une corruption au milieu du journal bloque le démarrage. Ce mécanisme reste une démonstration locale, sans ACK intermachine, réplication, stockage WORM ni politique de rétention industrielle.

## Interfaces internes, non finales

- `/api/control` : commandes du simulateur, jamais une interface automate.
- `/api/config` : configuration versionnée avec motif.
- `/api/inventory/selection`, `/api/inventory/export` : bilan spatial.
- `/api/scans/...` : brut et révisions.
- `/api/snapshot`, `/ws/live` : projection centrale pour le navigateur.
- `/api/history`, `/api/audit` : relecture de session et journal d'actions.
- `/api/map` et `/api/map/tiles/...` : emprise cartographique autorisée.

Les interfaces PLC, scanner réel, transport Edge, annuaire/RBAC, objets de surface validés et persistance centrale à grande échelle restent à définir selon leurs spécifications contrôlées. Les paramètres de démonstration ne sont pas des consignes ou limites de sécurité d'une installation réelle.
