# Mise à jour v2.1 — Jobs de simulation et produits multicolores

Cette version conserve la base `stockyard-fr-v2` et ajoute une couche de
simulation configurable pour la présentation.

## Ajouts principaux

- Écran **Simulation** en français avec création de jobs.
- Paramètres modifiables par job : type de stockage, parc, distance début/fin,
  vitesse du stacker, débit produit, accélération du temps et passages.
- Plusieurs produits par job, avec tonnage cible par passage.
- Visualisation des stocks en plusieurs couleurs selon les produits déposés.
- Résultats par job : tonnage total, volume, hauteur maximale, durée et
  répartition par produit.
- Duplication d'un job pour comparer l'impact d'un changement de paramètre.
- Les paramètres d'un job sont copiés au lancement : les modifications futures
  de configuration ne changent pas l'historique du job.

## Utilisation rapide

1. Ouvrir l'application : `http://localhost:3000`.
2. Aller dans **Simulation**.
3. Définir le type de stockage, la distance et les produits des passages.
4. Cliquer sur **Créer et lancer**.
5. Observer la croissance du stock en 3D et les couleurs par produit.
6. Consulter les résultats du job, puis **Dupliquer** pour tester un autre
   scénario.

## Limite volontaire MVP

Les jobs sont encore des scénarios de démonstration. Ils n'envoient aucune
commande vers un automate réel. La persistance actuelle reste basée sur le
journal fichier du backend Docker ; la base de données historique sera ajoutée
plus tard.
