# Studio Engine : dossier d'intégration pour le moteur local

Ce document décrit **tout ce qui a été construit dans `studio-engine`** et **comment l'intégrer au moteur de la session locale** (`montage.py`, `projet.yaml`, FFmpeg). Il est écrit pour être lu par la session Claude locale comme par un humain.

> **Règle n°1 : `studio-engine` complète le moteur local, il ne le remplace pas.**
> - Ne jamais supprimer ni réécrire `montage.py`.
> - FFmpeg reste le moteur de traitement média et de rendu de secours.
> - Les intégrations s'ajoutent à côté : nouvelle commande, nouveau module.

- **Dépôt** : `https://github.com/MarsToMemes/studio-engine`
- **Branche** : `claude/studio-montage-youtube-doc-dzcmsg`
- Tout ce qui est décrit ici est testé : 281 tests moteur, 33 tests cerveau, 25 tests du banc de test et 26 contrôles navigateur, tous verts.
- Le chemin complet **brief → plan → validation → compilation → rendu MP4** a été exécuté de bout en bout.

---

## 1. Ce que fait `studio-engine`, en une page

```
SCRIPT + VOIX (transcrite) + VISUELS + DOCUMENTS + MUSIQUE + SFX + DROITS
        │
        ▼
 editor-brain ─ ANALYSE ÉDITORIALE → STRUCTURE DU RÉCIT → PLAN DE PLANS → HIÉRARCHIE VISUELLE → CAMÉRA
 (le réalisateur)   → MOTION DESIGN → SOUND DESIGN → TRANSITIONS → SOUS-TITRES   (chaque décision justifiée)
        │
        ▼  ShotPlan v2 (JSON)  ◄─── validé contre VIDEO_EDITING_BIBLE.md (147 règles numérotées)
        │
 engine ─ compilation déterministe → VideoProject (scènes, calques, animations, audio)
 (l'exécutant)
        │
        ▼
 remotion ─ composition React → rendu MP4 1920×1080 H.264 30 i/s (aperçu 540p)
```

**Principe fondateur : l'IA est le réalisateur, le moteur est l'exécutant.**
- L'IA (ou les heuristiques) décide **quoi** montrer et **pourquoi**. Elle ne choisit que des éléments qui existent : skills, transitions, mouvements de caméra, sons.
- Le moteur décide **comment**, de façon déterministe.
- Un skill inconnu passe par une chaîne de repli : **le rendu n'échoue jamais pour une animation manquante**.

**Le cerveau n'invente jamais** :
- pas de graphique sans données ;
- pas de document qu'on ne lui a pas fourni ;
- pas de lieu inconnu ;
- pas d'image sans rapport avec le propos.

À la place, il produit une **demande d'asset** qui dit exactement quoi fournir.

---

## 2. Récupérer et installer

```bash
git clone -b claude/studio-montage-youtube-doc-dzcmsg https://github.com/MarsToMemes/studio-engine.git
cd studio-engine
npm install              # Node >= 20 (testé en 22)
npm run build            # construit engine + editor-brain (dist/), requis par les CLI
npm run check            # vérification des types + build + tous les tests
cd packages/remotion && npm run assets   # médias de test synthétiques dans public/ (facultatif)
```

**Rendu.**
- Remotion utilise Chrome ou Chromium headless.
- Sur la machine locale, Remotion télécharge son propre navigateur si besoin.
- Sinon, pointez-le avec `--browser-executable=<chemin>` ou la variable `REMOTION_BROWSER`.

**Variables d'environnement**

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Active le cerveau LLM (`--llm`). Sans elle, le cerveau heuristique prend le relais et le signale. |
| `REMOTION_BROWSER` | Chemin d'un Chrome/Chromium pour `scripts/render.mjs` (facultatif). |

---

## 3. Architecture du dépôt

```
studio-engine/
├── VIDEO_EDITING_BIBLE.md        la référence éditoriale : 147 règles (ID · sévérité · mode de contrôle)
├── SCENE_ENGINE.md               documentation technique complète (API, formats, choix)
├── LOCAL_ENGINE_INTEGRATION.md   contrat moteur local ↔ studio-engine (qui fait quoi)
├── STUDIO_ENGINE_HANDOFF.md      ce document
└── packages/
    ├── engine/        @studio-engine/scene-engine   moteur pur, zéro dépendance
    │   ├── src/model/          modèle de données : scènes, calques, animations, audio, sous-titres, assets (+ droits)
    │   ├── src/shotplan/       ShotPlan v1/v2, Timeline JSON, validation éditoriale, grammaire, compilation, CLI
    │   ├── src/skills/         Motion Skill Registry (49 skills), caméra de plan, replis
    │   ├── src/bible/          règles de la bible sous forme de données (générées depuis le .md)
    │   ├── src/transitions/    transitions éditoriales (coupe franche par défaut) → Remotion
    │   ├── src/adapters/remotion/  plan Remotion (séquences, audio, ducking, sous-titres)
    │   └── bin/shotplan.mjs    CLI : validate / timeline / compile
    ├── editor-brain/  @studio-engine/editor-brain   le cerveau éditorial
    │   ├── src/analyzer.ts … sound.ts   analyse, architecture, rythme, visuel, motion, son (déterministe)
    │   ├── src/llm/                     couche LLM (Claude via SDK officiel), validation, réparation, repli
    │   ├── src/examples/mcdonalds.ts    exemple complet du format d'entrée
    │   └── bin/editor-brain.mjs         CLI : direct [--plan] [--llm]
    ├── remotion/      @studio-engine/remotion       composition Remotion, graphiques, cartes, rendu
    │   ├── src/index.ts                 point d'entrée Remotion (compositions EngineDemo, ShotPlanDemo, BrainDemo)
    │   └── scripts/render.mjs           rendu des compositions de démo
    └── studio/        banc de test technique (aperçu @remotion/player + tests navigateur).
                       L'interface produit n'est PAS ici : elle est faite par Claude Design.
```

---

## 4. Les briques

### 4.1 La bible (`VIDEO_EDITING_BIBLE.md`)

- **Contenu** : 147 règles en 26 domaines. Narration, scènes, grammaire, rythme, hiérarchie visuelle, caméra, typographie, motion, transitions, sound design, musique, silence, documents, graphiques, cartes, sous-titres, couleur, répétitions, contraste, rappels visuels, escalade, révélations, chapitres, droits, technique.
- **Format** d'une règle : `RHY-03 · avertissement · AUTO — …`.
  - Sévérité : `bloquant`, `avertissement` ou `conseil`.
  - Contrôle : `AUTO` (code), `HEUR` (automatique mais approximatif) ou `REVUE` (IA critique ou humain).
- **45 règles sont vérifiées par le code**, sur 104 automatisables. Chaque problème signalé cite sa règle (`issue.rule`).
- La bible est la **source unique** :
  - le catalogue du code est généré depuis le `.md`, et un test échoue si les deux divergent ;
  - les instructions du LLM sont générées depuis les mêmes règles.
- **Échelles** : les scores éditoriaux sont des **niveaux de 1 à 5**. Ce sont des heuristiques, pas des mesures ; les décimales sont refusées.

### 4.2 Le moteur (`packages/engine`)

- **ShotPlan**, le langage de l'IA et de l'interface. Un plan ne stocke que sa **durée** : les positions sont calculées, donc changer une durée ne désynchronise jamais le reste.
- **ShotPlan v2**, le plan éditorial, ajoute :
  - chapitres → scènes (objectif) → étapes → plans ;
  - par plan : `editorialIntent`, `reasons` (le « pourquoi »), `importance`, `visualHierarchy`, `camera`, `framing`, `musicState`, `hold` ;
  - par épisode : **narration segmentée**, indications musicales, **silences contrôlés**, mémoire (motifs, rappels visuels) ;
  - pour chaque asset, ses **droits** dans `asset.source`.
- **Validation en deux étapes** :
  - `draft` : les règles bloquantes ne sont que des avertissements, pour que l'aperçu reste possible ;
  - `final` : elles deviennent des erreurs.
- **Compilation** : `compileShotPlan()` donne un `VideoProject` rendu par Remotion.
  - Les skills passent par le registre, avec repli.
  - Il y a une piste voix par segment, donc **la musique baisse sous chaque phrase et remonte dans les pauses**.
  - Les sous-titres sont synchronisés mot à mot, omis quand le texte à l'écran dit déjà la même chose, et ne chevauchent jamais deux phrases.
- **Caméra séparée du motion skill.**
  - Push ou pull de 5 à 10 %, pans, tilts, punch, parallaxe, tremblement.
  - Cadrage de large à très gros plan, autour d'un point d'intérêt.
  - Un skill qui bouge déjà la caméra l'emporte, et le moteur le signale (CAM-02).
- **Motion Skill Registry** : 49 skills en texte, chiffres, images, documents, données, cartes, révélations et éditorial. Il n'expose que ce qui peut réellement être rendu.
- **Transitions** : la coupe franche par défaut ; les transitions spectaculaires sont limitées (≤ 25 % des coupes, au plus 3 glitch).
- **Timeline JSON v2** : une vue à plat, **sans perte** dans les deux sens (`toTimeline` / `fromTimeline`).

### 4.3 Le cerveau éditorial (`packages/editor-brain`)

| Étape | Rôle |
|---|---|
| Analyseur éditorial | Pour chaque phrase : l'intention (17 possibles) avec l'indice qui la justifie, les niveaux de 1 à 5, les chiffres (écrits ou prononcés), les lieux, les citations et les mots à mettre en valeur |
| Alignement | Recale le script sur la transcription, même quand ils diffèrent (« 61 % » écrit, « sixty one percent » prononcé) |
| Architecte du récit | Chapitres, scènes avec objectif, étapes ; jamais de scène qui commence par une révélation |
| Monteur de rythme | Durées sur la voix, pauses selon le rythme choisi, coupes entre deux mots, hook de 1,5 à 2,5 s, **J-cuts** (le chiffre apparaît sur son mot) |
| Directeur visuel | Grammaire × assets disponibles, hiérarchie, cadrage, caméra justifiée, **motif réservé pour le rappel final** |
| Directeur motion | Skills installés, compatibles et applicables, gestionnaire de répétitions, budget d'intensité |
| Sound designer | Un état musical par scène, silence de 0,4 s avant la révélation majeure, SFX sur les événements réels, budget de densité |
| Contrôle qualité | Validation `final`, notes de compilation, « toute affirmation forte a sa preuve » |

**La couche LLM** (`--llm`) :
- **Rôle de Claude.** Il écrit l'analyse et les scènes via un outil imposé (sortie JSON contrainte), à partir d'instructions générées depuis la bible. Il ne fournit ni timing, ni chiffres, ni données.
- **Contrôle.** Les règles valident la réponse, un tour de réparation renvoie les erreurs exactes, et ce qui reste faux retombe sur l'heuristique. Vos indications d'auteur l'emportent toujours.
- **Aucune panne ne bloque la vidéo** : sans clé, en cas d'erreur d'API ou de réponse tronquée, le cerveau heuristique prend le relais.
- **Rejouable** : la réponse du modèle (`llm.answer`) redonne exactement le même plan sans rappeler l'API.

### 4.4 Remotion (`packages/remotion`)

- **Rôle** : la composition React qui rend un `VideoProject`.
- **Rendu** : textes cinétiques, chiffres, graphiques (barres, courbes, camemberts, comparaisons), carte du monde (données Natural Earth, domaine public), documents avec surlignage et source, sous-titres, transitions.
- **Médias** : un média illisible est remplacé par un cadre de remplacement, jamais par un écran noir ni un crash.
- **Compositions** :
  - `EngineDemo` : **rend n'importe quel projet passé en `--props`** ; c'est celle qu'utilise le moteur local ;
  - `ShotPlanDemo` et `BrainDemo` : les exemples.

---

## 5. Formats d'échange

### 5.1 Entrée du cerveau : `BrainInput` (recommandé)

C'est ce que le moteur local doit produire depuis `projet.yaml`. Exemple complet : `packages/editor-brain/src/examples/mcdonalds.ts`.

```jsonc
{
  "title": "McDonald's real estate",
  "fps": 30, "width": 1920, "height": 1080,          // facultatifs
  "script": [
    { "kind": "chapter", "title": "The real business", "question": "How does McDonald's really make money?" },
    { "kind": "text", "text": "McDonald's isn't a burger company." },
    { "kind": "text", "text": "Rent keeps growing year after year.",
      "hints": { "chart": { "kind": "barChart", "labels": ["2019","2021","2023"], "values": [7.6,8.9,9.9], "unit": "B$", "title": "Rent income", "source": "Annual reports" } } }
  ],
  "assets": {
    "narration": { "id": "narration", "kind": "audio", "src": "http://localhost:8080/ep01/voice.wav", "durationInSeconds": 612.4,
                   "source": { "provider": "own production", "license": "own", "commercialUse": true, "attributionRequired": false } },
    "report":    { "id": "report", "kind": "image", "src": "http://localhost:8080/ep01/report.png", "width": 1654, "height": 2339,
                   "source": { "provider": "McDonald's IR", "license": "press use", "commercialUse": true, "attributionRequired": true,
                               "attribution": "McDonald's Annual Report 2023" } }
  },
  "catalog": [
    { "assetId": "report", "description": "McDonald's Annual Report 2023", "tags": ["document", "annual report"],
      "regions": [{ "text": "revenues from franchised restaurants rent and royalties", "x": 9, "y": 26, "width": 72, "height": 4 }] }
  ],
  "narration": { "assetId": "narration", "words": [{ "text": "McDonald's", "startMs": 200, "endMs": 700 }] },
  "music": { "assetId": "music", "gainDb": -18, "duckDb": -6 },
  "sfx": { "impact": ["sfx-impact"], "glitch": ["sfx-glitch"], "whoosh": [], "pop": [] },
  "pacing": "standard"                                // calm | standard | dynamic
}
```

**Règles importantes**
- **`narration.words`** : transcription mot à mot, en **millisecondes du fichier de voix**, triée. Sans elle, le timing est estimé et les sous-titres sont désactivés.
- **`catalog`** : c'est ce qui permet au cerveau de choisir les images.
  - La correspondance se fait par les mots de `description` et `tags`, sans synonymes : **décrivez ce que montre l'image**.
  - Un document se déclare avec un tag `document`, `report` ou `pdf`, et ses zones de texte (`regions`, en pourcentage de la page) permettent de surligner la phrase lue.
- **`hints`** : ce que le cerveau ne doit pas deviner.
  - Données de graphique (`chart`), lieux (`map` ou `places`), média imposé (`media`), intention imposée (`intent`), mots à mettre en valeur (`highlightedWords`).
  - Les hints gagnent toujours.
- **`sfx`** : la bibliothèque de sons par catégorie. Catégories possibles : whoosh, impact, hit, riser, drop, glitch, click, pop, bass, reveal, transition, notification, document, camera, digital, ambient. Une catégorie absente donne une demande d'asset.
- **Droits** : chaque asset a un `source` avec au moins `license` et `commercialUse`. C'est bloquant en validation `final` (SRC-01). `syntheticMedia: true` signale une vidéo IA réaliste, pour le rappel de déclaration YouTube.

### 5.2 Médias : où les mettre

- `src` = une URL `http(s)://`, ou un chemin relatif au dossier `packages/remotion/public/`. Le navigateur de rendu ne lit pas les chemins absolus du disque.
- En local, le plus simple : `python -m http.server 8080` dans le dossier de l'épisode, ou copier les médias dans `public/`.
- `durationInSeconds`, `width`, `height` et `fps` viennent de `ffprobe` : le moteur ne les devine pas.
- Vidéos : MP4 H.264/AAC (Chrome et le rendu Remotion les lisent), ou WebM/VP9.

### 5.3 Sorties

| Fichier | Contenu |
|---|---|
| `plan.json` | ShotPlan v2, le **plan éditorial** : c'est lui qu'on stocke, qu'on modifie et qu'on re-valide |
| `timeline.json` | Timeline JSON v2 à plat : positions calculées, intentions, caméra, états musicaux, segments de voix, silences, chapitres, scènes |
| `project.json` | Document `VideoProject` compilé (`{ format, schemaVersion, project }`), prêt pour Remotion |
| Sortie de `direct` (sans `--plan`) | `{ plan, analysis, structure, assetRequests, decisions, qc, llm? }` : tout le raisonnement du cerveau |

---

## 6. Commandes (vérifiées)

```bash
# 1. Le cerveau décide (heuristique ; ajouter --llm pour Claude)
node packages/editor-brain/bin/editor-brain.mjs direct input.json --plan > plan.json
#    code de sortie : 0 = plan valide en final · 1 = plan produit mais pas final-valid (le JSON dit pourquoi) · 2 = entrée illisible
#    stderr : "decision: …" (choix notables) et "needs <type> (<phrase>): …" (assets à fournir)

# 2. Vérifier / exporter
node packages/engine/bin/shotplan.mjs validate plan.json --stage=final   # problèmes + règle de la bible, code 1 si erreurs
node packages/engine/bin/shotplan.mjs timeline plan.json > timeline.json
node packages/engine/bin/shotplan.mjs compile  plan.json > project.json  # notes de compilation sur stderr

# 3. Rendre le plan (composition EngineDemo + props). props.json = { "project": <project.json>.project }
cd packages/remotion
npx remotion render src/index.ts EngineDemo out/episode.mp4 --props=props.json                 # 1080p H.264
npx remotion render src/index.ts EngineDemo out/preview.mp4 --props=props.json --scale=0.5     # aperçu 540p
```

---

## 7. Intégration côté `montage.py`, pas à pas

À **ajouter** à côté de `montage.py`, par exemple un module `studio_bridge.py` et une commande `--studio`, sans changer le pipeline existant.

```python
import json, subprocess, pathlib

STUDIO = pathlib.Path("~/studio-engine").expanduser()

def ffprobe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height,r_frame_rate",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

def normalize_voice(src, dst):
    # Voix à -16 LUFS, true peak -1 dBTP (bible MUS-01 / TECH-05). Idéalement deux passes (mesure puis correction).
    subprocess.run(["ffmpeg", "-y", "-i", str(src), "-af", "loudnorm=I=-16:TP=-1:LRA=11", "-ar", "48000", str(dst)], check=True)

def transcribe_words(voice):
    # Whisper local (faster-whisper) avec horodatage par mot → millisecondes.
    from faster_whisper import WhisperModel
    segments, _ = WhisperModel("medium").transcribe(str(voice), word_timestamps=True)
    return [{"text": w.word.strip(), "startMs": round(w.start * 1000), "endMs": round(w.end * 1000)}
            for s in segments for w in s.words]

def build_brain_input(projet):            # projet = projet.yaml chargé
    # À ÉCRIRE selon la structure de projet.yaml : script (chapitres + phrases), assets (+ droits),
    # catalogue (description / tags / zones des documents), musique, sons par catégorie.
    ...

def direct_and_render(brain_input, workdir, use_llm=False):
    (workdir / "input.json").write_text(json.dumps(brain_input))
    cmd = ["node", str(STUDIO / "packages/editor-brain/bin/editor-brain.mjs"), "direct", str(workdir / "input.json"), "--plan"]
    if use_llm: cmd.append("--llm")
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stderr)                         # décisions + demandes d'assets à traiter
    (workdir / "plan.json").write_text(r.stdout)
    if r.returncode != 0:
        raise RuntimeError("plan non valide en final : voir qc / demandes d'assets")
    subprocess.run(["node", str(STUDIO / "packages/engine/bin/shotplan.mjs"), "compile", str(workdir / "plan.json")],
                   stdout=open(workdir / "project.json", "w"), check=True)
    project = json.loads((workdir / "project.json").read_text())["project"]
    (workdir / "props.json").write_text(json.dumps({"project": project}))
    subprocess.run(["npx", "remotion", "render", "src/index.ts", "EngineDemo", str(workdir / "episode.mp4"),
                    f"--props={workdir / 'props.json'}"], cwd=STUDIO / "packages/remotion", check=True)
```

**Qui fait quoi**

| Moteur local (montage.py + FFmpeg) | studio-engine |
|---|---|
| Lire `projet.yaml`, organiser les médias | Décisions éditoriales, plan, timeline |
| `ffprobe` (durées, tailles, fps) | Motion, caméra, transitions, sous-titres |
| Voix à −16 LUFS, pic vrai ≤ −1 dBTP | Validation contre la bible |
| Transcription mot à mot (Whisper ou ElevenLabs) | Rendu Remotion |
| Conversion des médias en formats lisibles par le navigateur | Aperçu (via l'interface Claude Design) |
| Droits des assets (`source`) | |
| Rendu FFmpeg de secours, mixage final si besoin | |

---

## 8. État d'avancement

**Fait**

| Brique | Statut |
|---|---|
| Bible du montage (147 règles, 45 vérifiées par le code) | ✅ |
| ShotPlan v2, Timeline JSON v2, narration segmentée, droits des assets | ✅ |
| Moteur Remotion (composition, graphiques, cartes, documents, sous-titres, rendu MP4) | ✅ |
| Motion Skill Registry (49 skills, replis, caméra séparée) | ✅, v2 en cours |
| Cerveau éditorial déterministe (analyse → plan complet justifié) | ✅ |
| Cerveau LLM (Claude, validé et réparé par les règles, repli heuristique) | ✅ (non testé avec une vraie clé) |
| CLI pour le moteur local (`editor-brain`, `shotplan`), rendu d'un plan par `--props` | ✅ vérifié |

**Pas encore fait** (dans l'ordre prévu)
1. **Motion Skill Registry v2** : API `getMotionSkill` / `getCompatibleSkills` / `getFallbackSkill`, les 16 skills manquants, `city_zoom` (MapLibre, niveau rue), dossier `/motion-library/`.
2. **Sound design au rendu.**
   - Les états musicaux et les silences sont **décidés et validés mais pas encore audibles** : la musique joue à un niveau constant, avec ducking par phrase.
   - La mesure LUFS se fera avec le FFmpeg local.
3. **Contrôle qualité sur le rendu** : images noires, saturation audio, polices, `QC_REPORT.json`, et critique éditoriale par IA (règles REVUE).
4. **`RenderEngine`** : `RemotionRenderer` / `FFmpegRenderer` (branché sur `montage.py`), cache de rendu.
5. **Commandes en langage naturel** (« rends cette révélation plus forte ») : des opérations sur le plan, avec diff et annulation.
6. **Épisode test professionnel** : vraie voix, vrais médias sous licence.

**Limites connues**
- Le cerveau heuristique :
  - rate les révélations sans indice dans le texte (le LLM les trouve) ;
  - ne comprend les nombres écrits en toutes lettres qu'en anglais ;
  - ne connaît que 70 lieux.
- **Le cerveau LLM** fait un seul appel par épisode : au-delà d'environ 400 phrases, il faudra découper par chapitre.
- **L'alignement** script/transcription gère jusqu'à environ 20 minutes de texte d'un coup.
- **Un cadrage serré sur une image basse résolution** l'agrandit, avec une perte de netteté. Le contrôle de résolution est prévu au contrôle qualité.

---

## 9. Licences et droits

- **Remotion** : gratuit jusqu'à 3 personnes dans l'entreprise, licence payante au-delà (voir remotion.pro).
- **`@anthropic-ai/sdk`** : MIT. **Natural Earth / world-atlas** : domaine public / ISC. **d3-geo**, **topojson-client** : ISC.
- **Règles du projet** :
  - aucun téléchargement automatique de vidéo YouTube ni d'asset commercial sans licence vérifiée ;
  - un asset aux droits incertains n'est pas utilisé ;
  - les attributions requises sont listées dans le rapport ;
  - une vidéo IA réaliste déclenche le rappel de déclaration YouTube (contenu altéré ou synthétique).

---

## 10. Instructions à coller dans la session locale

> Le dépôt `MarsToMemes/studio-engine` (branche `claude/studio-montage-youtube-doc-dzcmsg`) complète notre moteur vidéo. Lis `STUDIO_ENGINE_HANDOFF.md`, puis `LOCAL_ENGINE_INTEGRATION.md` et `VIDEO_EDITING_BIBLE.md`. **Ne supprime pas et ne réécris pas `montage.py`** : ajoute l'intégration à côté (module `studio_bridge.py`, commande `--studio`).
>
> 1. Clone le dépôt à côté du projet, puis `npm install && npm run build && npm run check`.
> 2. Décris la structure de `projet.yaml` et le pipeline de `montage.py` dans `docs/montage-pipeline.md`.
> 3. Écris `build_brain_input(projet)` (section 5.1) :
>    - script (chapitres + phrases) ;
>    - assets avec `ffprobe` et droits dans `source` ;
>    - catalogue (description, tags, zones de texte des documents) ;
>    - voix normalisée à −16 LUFS et transcrite mot à mot ;
>    - musique, sons par catégorie.
> 4. Sers les médias en http (ou copie-les dans `packages/remotion/public/`).
> 5. Lance `editor-brain direct input.json --plan`, traite les demandes d'assets affichées, valide avec `shotplan validate --stage=final`, compile et rends avec `EngineDemo --props` (section 6).
> 6. Garde le rendu FFmpeg de `montage.py` comme repli.
> 7. Liste ce que `projet.yaml` contient et que le format ne sait pas encore représenter, pour les prochaines phases.
