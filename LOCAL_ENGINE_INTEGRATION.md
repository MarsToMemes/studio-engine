# Intégration avec le moteur local (montage.py)

`studio-engine` **complète** le moteur de la session locale (`montage.py`, `projet.yaml`, FFmpeg). Il ne le remplace pas.

- **Aucune règle ici ne supprime `montage.py`.**
- FFmpeg reste le moteur de traitement média et de repli.

Ce document est le contrat entre les deux. Il est écrit pour être lu par la session Claude locale, qui a accès à `montage.py`, contrairement à cette session.

## Qui fait quoi

| Responsabilité | Moteur local (montage.py + FFmpeg) | studio-engine |
|---|---|---|
| Lecture de `projet.yaml`, organisation des médias de l'épisode | ✅ | — |
| Mesure des médias (durées, dimensions, fps) | ✅ `ffprobe` | lit les valeurs fournies |
| Normalisation de la voix à −16 LUFS, true peak ≤ −1 dBTP (bible MUS-01, TECH-05) | ✅ `loudnorm` en deux passes | vérifie les valeurs fournies (QC) |
| Transcription mot à mot de la voix off | ✅ Whisper local (`word_timestamps`) ou ElevenLabs | consomme `narration.words` |
| Découpage de la narration en segments (phrases), requis par les silences (SIL) et le ducking par segment (MUS-06) | ✅ découpe audio | positionne les segments dans la timeline |
| Conversion des médias en formats lisibles par le navigateur (H.264/AAC, ou VP9/WebM) | ✅ | — |
| Décisions éditoriales, plan, timeline, motion, transitions, SFX, musique | — | ✅ (cerveau éditorial, registres, bible) |
| Aperçu en direct, édition de la timeline | — | ✅ `packages/studio` |
| Rendu final | repli FFmpeg (`FFmpegRenderer`) | ✅ Remotion (`RemotionRenderer`) |
| Mixage final / masterisation audio si besoin | ✅ | — |

## Format d'échange

**Aujourd'hui : `ShotPlan` v1 (JSON).** Voir SCENE_ENGINE.md §15. L'essentiel :

```json
{
  "version": 1, "fps": 30, "width": 1920, "height": 1080,
  "assets": {
    "narration": { "id": "narration", "kind": "audio", "src": "http://localhost:8080/ep01/voice.wav", "durationInSeconds": 612.4 },
    "report":    { "id": "report", "kind": "image", "src": "http://localhost:8080/ep01/annual-report.png", "width": 1654, "height": 2339,
                   "source": { "provider": "McDonald's IR", "url": "https://corporate.mcdonalds.com", "license": "press use",
                               "commercialUse": true, "attributionRequired": true, "attribution": "McDonald's Annual Report 2023" } }
  },
  "narration": { "assetId": "narration", "words": [{ "text": "McDonald's", "startMs": 0, "endMs": 420 }] },
  "music": { "assetId": "music", "gainDb": -18, "duckDb": -6 },
  "shots": [ { "id": "hook", "type": "text", "durationInFrames": 66, "text": "McDonald's isn't a burger company", "highlightedWords": ["burger"] } ]
}
```

**Règles pour les médias :**
- `src` est une URL `http(s)://` ou un chemin relatif au dossier `public/` de Remotion. Le navigateur (aperçu et rendu) ne lit pas de chemin absolu du disque. En local, le plus simple est un serveur statique sur le dossier de l'épisode (`python -m http.server 8080`).
- `durationInSeconds`, `width`, `height` et `fps` viennent de `ffprobe`. Le moteur ne les devine pas.
- Vidéos : H.264/AAC en MP4. Le Chromium open source ne lit pas le H.264 ; Chrome et le rendu Remotion le lisent. WebM/VP9 est lu partout.
- `narration.words` : les temps en millisecondes absolues depuis le début du fichier de voix, triés.

**Plan éditorial v2** (voir SCENE_ENGINE.md §15.1). Un plan v1 reste accepté tel quel. En v2, le moteur local fournit surtout deux choses :

1. **Les droits de chaque asset**, dans `asset.source` :
   - `license` et `commercialUse` sont obligatoires en v2 ;
   - `attributionRequired`, `attribution` et `url` quand ils s'appliquent ;
   - `syntheticMedia: true` pour une vidéo IA réaliste.
2. **La narration découpée en segments** (`narration.segments`) : une plage du fichier de voix par phrase, avec `sourceStartMs` et `sourceEndMs` tirés de la transcription mot à mot.
   - `startFrame` indique où la phrase joue dans la timeline. Il peut être décidé par le cerveau éditorial ; par défaut, les phrases se suivent.
   - C'est ce qui permet les pauses, les cartons de chapitre muets, les silences avant une révélation et une musique qui remonte entre les phrases.
   - Les `narration.words` restent en millisecondes **du fichier de voix** : le moteur les place lui-même.

Les champs éditoriaux (intentions, justifications, scènes, caméra, états musicaux) sont produits par le cerveau éditorial de `studio-engine`. Le moteur local n'a pas à les inventer.

Validation :
- `shotplan validate plan.json` : mode brouillon ;
- `shotplan validate plan.json --stage=final` : avant le rendu final, les règles bloquantes deviennent des erreurs.

## Deux façons de brancher le moteur local

1. **Le moteur local écrit le plan** (`plan.json`, ShotPlan v1 ou v2) : `studio-engine` le valide, le compile et le rend.
2. **Le moteur local fournit la matière, le cerveau éditorial décide** (recommandé). Le moteur local écrit une entrée `BrainInput` avec :
   - le script (et ses chapitres) ;
   - la transcription mot à mot ;
   - les assets avec leurs droits et un catalogue (description, tags, zones de texte des documents) ;
   - la musique et la bibliothèque de sons par catégorie.

   `editor-brain` produit alors le plan v2 complet, justifié et validé :

   ```bash
   node packages/editor-brain/bin/editor-brain.mjs direct input.json --plan > plan.json
   # stderr : décisions et demandes d'assets (document manquant, données de graphique, sons…)
   ```

   Avec `--llm`, c'est Claude qui écrit l'analyse éditoriale et les scènes (clé `ANTHROPIC_API_KEY` dans l'environnement), vérifiées par les règles de la bible. Sans clé, ou si l'API échoue, le cerveau heuristique prend le relais et l'indique.

   Exemple de format : `packages/editor-brain/src/examples/mcdonalds.ts`. Le cerveau **n'invente rien** : un graphique sans données, un document absent ou un lieu inconnu donnent une demande d'asset, jamais un faux.

## Points d'entrée disponibles aujourd'hui

```bash
npm run build                                               # une fois
node packages/engine/bin/shotplan.mjs validate plan.json    # erreurs et avertissements (avec les règles de la bible), code 1 si erreurs
node packages/engine/bin/shotplan.mjs timeline plan.json    # Timeline JSON à plat (images de début calculées)
node packages/engine/bin/shotplan.mjs compile  plan.json    # VideoProject complet
```

Depuis Python :

```python
import json, subprocess
r = subprocess.run(["node", "packages/engine/bin/shotplan.mjs", "validate", "plan.json"], capture_output=True, text=True)
report = json.loads(r.stdout)   # {"valid": bool, "errors": [...], "warnings": [...]}, chaque issue a "code" et souvent "rule"
```

**Manques connus**, prévus dans les phases indiquées :
- le studio ne sait pas encore ouvrir un plan externe : il n'a pas de bouton « Ouvrir un plan » (phase 8, interface) ;
- le script de rendu ne rend que les compositions de démo, pas un `plan.json` fourni : `RenderEngine` et `render --plan` arrivent en phase 10.

## Travail à faire côté session locale

À transmettre tel quel à la session Claude locale :

> Le dépôt `MarsToMemes/studio-engine` (branche `claude/studio-montage-youtube-doc-dzcmsg`) complète notre moteur. Lis `LOCAL_ENGINE_INTEGRATION.md`, `VIDEO_EDITING_BIBLE.md` et `SCENE_ENGINE.md` §15. **Ne supprime pas `montage.py`.** Ensuite :
>
> 1. Décris la structure de `projet.yaml` et le pipeline de `montage.py` (entrées, étapes FFmpeg, sorties), dans un fichier `docs/montage-pipeline.md` à envoyer dans `studio-engine`.
> 2. Écris un exporteur `projet.yaml` → `plan.json` (ShotPlan, SCENE_ENGINE.md §15 et §15.1) :
>    - assets avec `ffprobe` et droits dans `asset.source` ;
>    - voix normalisée à −16 LUFS ;
>    - transcription mot à mot ;
>    - `narration.segments`, une plage par phrase.
>
>    Ne change pas le comportement actuel de `montage.py` : ajoute une commande ou un module à côté.
> 3. Valide le résultat avec `node packages/engine/bin/shotplan.mjs validate plan.json` et corrige les erreurs.
> 4. Liste ce que `projet.yaml` contient et que ShotPlan ne sait pas encore représenter : ce sera ajouté au format dans une prochaine phase.

## Questions à régler avec `projet.yaml`

1. Le script est-il découpé en phrases ou en paragraphes ? Chaque bloc a-t-il déjà un média associé ?
2. La voix off est-elle un seul fichier ou un fichier par bloc ? Est-elle générée (TTS) ou enregistrée ?
3. Où sont les métadonnées de licence des médias, s'il y en a ?
4. Quelles décisions `montage.py` prend-il aujourd'hui : durées, transitions, zooms, musique ? Ce sont elles que le cerveau éditorial reprendra.
5. Quelles sorties le reste de la chaîne attend-il : nom du MP4, sous-titres SRT, miniatures ?
