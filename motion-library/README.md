# Motion Library

Catalogue des **65 motion skills** du moteur, avec un aperçu par skill, et le manifeste des packs d'assets sous licence.
Tout ici est **généré ou déclaré**. Aucun asset n'est téléchargé automatiquement.

```
motion-library/
  catalog.json          ← généré : métadonnées de chaque skill + chemin de son aperçu + transitions éditoriales
  previews/<id>.jpg     ← généré : une image par skill (480×270, image « poster » après l'animation)
  assets/
    manifest.json       ← déclaré à la main : les assets sous licence que le moteur a le droit d'utiliser
    transitions/ lower-thirds/ overlays/ icons/ backgrounds/ lottie/ sfx/ music/
```

## Regénérer

```bash
npm run build                                  # engine + editor-brain
cd packages/remotion
npm run assets                                 # médias de démo (landscape.png, clip.webm, report.png) + worker MapLibre
npm run previews -- --browser=/chemin/vers/chrome   # 65 images + catalog.json (~1 min)
npm run previews -- --only=light_reveal,city_zoom   # seulement certains skills
```

Sans `--browser`, Remotion télécharge son Chrome headless (il faut un accès réseau à remotion.media).
La composition Remotion `MotionLibrary` joue toutes les skills à la suite (3 s chacune) : `npx remotion studio src/index.ts`.

## catalog.json

| Champ | Sens |
|---|---|
| `id`, `name`, `description` | identité du skill (ce que l'IA voit dans son prompt) |
| `category` | text · numbers · images · documents · data · maps · reveals · editorial |
| `family` | regroupe les quasi-doublons pour le gestionnaire de répétition (REP-01) : `pan_left` et `pan_right` → `pan` |
| `implementation` | `remotion` (47), `svg` (17, graphiques du renderer de référence), `maplibre` (1, `city_zoom`) |
| `intensity`, `duration {min,max}`, `defaultDuration` | réglages ; `defaultDuration` = milieu de la plage |
| `compatibleShotTypes` | types de plans où le skill s'applique |
| `fallback` | chaîne de repli si le skill ne peut pas s'appliquer ; puis le repli sûr du type de plan |
| `events` | événements éditoriaux émis (keyword, impact, reveal…) qui servent au sound design |
| `controlsCamera` | le skill bouge la caméra : un mouvement de caméra du plan est alors ignoré (CAM-02) |
| `preview` | chemin de l'image d'aperçu |

`transitions` liste les transitions éditoriales (grammaire du montage), pas des assets.

Les aperçus sont des **images fixes** : elles montrent la composition, pas le mouvement.
Pour voir le mouvement, jouer la composition `MotionLibrary`. Côté code, `skillPreviewPlan(skill)` renvoie un plan d'un plan qui se joue dans `@remotion/player`.

## assets/manifest.json : packs sous licence

Le moteur ne propose à l'IA **que** des assets dont les droits sont enregistrés (règle SRC-01 de la bible).
Pour ajouter un asset :

1. le fichier est acquis par une personne (achat, CC0, production maison…) et posé dans le bon dossier ;
2. on ajoute son entrée au manifeste :

```json
{
  "version": 1,
  "assets": [
    {
      "id": "whoosh_soft",
      "category": "sfx",
      "kind": "audio",
      "src": "motion-library/assets/sfx/whoosh_soft.wav",
      "tags": ["transition", "soft"],
      "source": {
        "provider": "own production",
        "license": "own",
        "commercialUse": true,
        "attributionRequired": false
      }
    }
  ]
}
```

`category` : transition · lower_third · overlay · icon · background · lottie · sfx · music · footage · image.

`loadAssetManifest(manifest)` (engine) renvoie `{ assets, byCategory, rejected }`. Une entrée est **rejetée** dans ces cas :

- pas de `source.license` ou de `source.commercialUse` ;
- `commercialUse: false` ;
- `attributionRequired` sans texte d'`attribution` ;
- id en double, catégorie inconnue ou `src` absent.

Les rejets sont listés avec leur raison ; ils ne sont jamais ajoutés au plan. Pour une vidéo réaliste générée par IA, mettre `source.syntheticMedia: true`. C'est ce qui déclenche le rappel de divulgation YouTube « contenu altéré ou synthétique » (SRC-04).

## city_zoom et les tuiles de carte

`city_zoom` (MapLibre) ne s'applique que si le plan donne `map.style` :

- soit une URL de style MapLibre (fournisseur de tuiles sous licence, ou PMTiles auto-hébergées) ;
- soit `offline:natural-earth`, qui donne les pays seuls, sans réseau, et ne sert qu'à tester le pipeline.

Sinon, le moteur se replie sur `map_zoom` (SVG). `map.attribution` est affichée à l'écran (MAP-05).
Les tuiles ne sont **pas** fournies ici : leur licence et leur quota dépendent du fournisseur choisi.
