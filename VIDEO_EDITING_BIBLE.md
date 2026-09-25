# VIDEO EDITING BIBLE

La référence éditoriale du moteur. Tout plan, toute timeline et toute commande produits par l'IA sont validés contre ces règles. Le moteur n'est pas un générateur d'effets : c'est un monteur, un réalisateur de documentaire et un motion designer qui **pensent avant d'exécuter**.

> Le moteur ne se demande jamais « j'ai une animation sympa, où la placer ? ».
> Il se demande : « l'histoire a besoin d'un changement visuel ici ; quelle est la façon la plus claire et la plus cinématographique de faire passer cette information ? Que doit voir le spectateur ? Qu'est-ce qui bouge, qu'est-ce qui reste immobile ? Combien de temps ? Que fait le son ? Comment ce plan prépare-t-il le suivant ? »

---

## 0. Mode d'emploi

### Format des règles

Chaque règle a un identifiant stable, une sévérité et un mode d'application :

```
- **RHY-03** · avertissement · AUTO — énoncé de la règle
```

| Sévérité | Effet |
|---|---|
| `bloquant` | Le plan ou le rendu final est refusé tant que la règle n'est pas respectée. |
| `avertissement` | Le plan est accepté, le problème est signalé (QC, inspecteur) et l'IA doit le corriger ou le justifier. |
| `conseil` | Bonne pratique ; sert à départager deux options. |

| Application | Qui vérifie |
|---|---|
| `AUTO` | Contrôle déterministe dans le code (validation, QC). Fiable. |
| `HEUR` | Contrôle automatique approximatif (seuils, fenêtres glissantes). Peut produire des faux positifs : **jamais bloquant**. |
| `REVUE` | Jugement éditorial : relecture par l'IA critique (EDITORIAL_QC) ou par l'humain. |

- Le catalogue des règles utilisé par le code est **généré à partir de ce fichier** (`packages/engine/src/bible/rules.generated.ts`). Un test échoue si les deux divergent.
- Modifier un seuil se fait donc ici **et** dans le contrôle correspondant.
- Les messages de validation et de QC citent l'identifiant de la règle (`[RHY-03]`).

### Vocabulaire

```
ÉPISODE
└── CHAPITRE            un enjeu, une question, 1–4 min
    └── SCÈNE           un objectif narratif, 15–60 s
        └── ÉTAPE       setup · development · contradiction · escalation · revelation · proof · payoff · aftermath · transition
            └── PLAN    ce que voit le spectateur entre deux coupes
```

### Échelles éditoriales

- Les scores du cerveau éditorial sont notés sur **5 niveaux ordinaux**, de 1 (faible) à 5 (maximal) :
  - importance de l'information ;
  - surprise ;
  - densité d'information ;
  - potentiel visuel ;
  - tension.
- Ce sont des **heuristiques de montage**, pas des mesures. Un niveau ordinal est plus stable d'un appel du LLM à l'autre qu'un décimal comme 0,87, qui donne une fausse précision.
- Aucun de ces scores n'est présenté à l'utilisateur comme une mesure objective de l'émotion ou de la qualité.

### Ordre de raisonnement (obligatoire)

Pour chaque moment du script, dans cet ordre :

1. Quelle information est importante ?
2. Quelle est l'intention éditoriale ?
3. Quelle image raconte le mieux cette information ?
4. Faut-il montrer, expliquer, comparer, prouver ou révéler ?
5. Quel cadrage, quel mouvement de caméra ?
6. Quel niveau de mouvement ?
7. Quel rythme ?
8. Quel son accompagne l'action ?
9. Faut-il une transition ?
10. Comment préparer le plan suivant ?

Les effets sont la **conséquence** de ces décisions.

---

## 1. Direction et raisonnement (DIR)

- **DIR-01** · bloquant · AUTO — Chaque plan porte une intention éditoriale (`editorialIntent`) et une justification courte (`reason`) ; un plan sans intention est refusé.
- **DIR-02** · avertissement · REVUE — La justification dit ce que le spectateur doit comprendre, ressentir ou découvrir ; elle ne décrit pas l'effet (« pour dynamiser » est refusé).
- **DIR-03** · avertissement · AUTO — L'IA ne choisit que des skills, transitions, mouvements de caméra et SFX présents dans les registres ; un identifiant inconnu passe par la chaîne de repli et n'est jamais inventé.
- **DIR-04** · avertissement · REVUE — Chaque plan prépare le suivant : question ouverte, mouvement qui se prolonge, son qui annonce, chiffre attendu.
- **DIR-05** · conseil · REVUE — Entre deux options équivalentes, choisir la plus simple : moins de mouvement, moins de texte, coupe franche.

---

## 2. Narration (STORY)

- **STORY-01** · avertissement · REVUE — Chaque chapitre pose une question au spectateur avant d'y répondre.
- **STORY-02** · avertissement · REVUE — Une information importante = un plan principal ; deux informations importantes ne se partagent pas le même plan.
- **STORY-03** · avertissement · REVUE — Montrer plutôt que dire : quand la voix énonce un fait visualisable (lieu, chiffre, preuve), l'image le montre au lieu de l'illustrer vaguement.
- **STORY-04** · avertissement · REVUE — Pas d'illustration littérale pauvre (voix « argent » → billets génériques) : l'image apporte une information que la voix ne donne pas, ou la prouve.
- **STORY-05** · avertissement · HEUR — Toute affirmation forte (chiffre clé, accusation, révélation) est suivie d'une preuve visuelle (document, graphique, source) dans les deux plans suivants.
- **STORY-06** · conseil · REVUE — Le hook annonce la promesse de la vidéo dans les 10 premières secondes, sans tout révéler.
- **STORY-07** · avertissement · REVUE — La conclusion répond à la question posée par le hook.

---

## 3. Construction des scènes (SCENE)

On ne monte pas `phrase → clip → transition` en boucle. On construit des scènes :

```
SCÈNE : « Comment McDonald's gagne réellement son argent »
├── objectif      faire comprendre que le vrai business est l'immobilier
├── setup         images de restaurants
├── development   clients, produits, magasins
├── contradiction « Mais le vrai business n'est pas celui que vous pensez. »
├── (bascule)     coupe franche, la musique se retire
├── revelation    grande typographie cinétique « THE REAL BUSINESS »
├── proof         rapport annuel, phrase surlignée
├── escalation    carte, emplacements, chiffres
├── payoff        comparaison financière animée
└── transition    une question ouvre la scène suivante
```

- **SCENE-01** · bloquant · AUTO — Chaque plan appartient à une scène et chaque scène déclare son objectif narratif (`purpose`) en une phrase.
- **SCENE-02** · avertissement · AUTO — Chaque scène contient au moins une étape de mise en place (`setup`) et une étape de résolution (`payoff`, `revelation` ou `proof`).
- **SCENE-03** · avertissement · REVUE — À l'intérieur d'une scène, les plans montent en information ou en intensité jusqu'au payoff (escalade visuelle).
- **SCENE-04** · conseil · HEUR — Une scène dure en général 15 à 60 s ; au-delà, la découper ou créer une relance.
- **SCENE-05** · avertissement · REVUE — Le dernier plan d'une scène prépare la suivante (question, changement d'état musical, changement de lieu).

---

## 4. Grammaire éditoriale (GRAM)

L'intention décide du traitement, jamais l'inverse. Traitements par défaut :

| Intention (`editorialIntent`) | Traitement | Skills typiques | Caméra | Son |
|---|---|---|---|---|
| `hook` | image forte + typographie courte | keyword_pop, kinetic_statement | punch-in | impact discret |
| `context` | image, mouvement retenu | slow_zoom, slow_push | push lent | — |
| `fact` | image + mouvement retenu | slow_zoom, pan | push lent | — |
| `important_fact` | image + typographie cinétique | highlight_word, kinetic_statement | push lent | pop discret |
| `keyword` | mot-clé mis en valeur | keyword_pop, word_reveal, mask_reveal | statique | click/pop |
| `number` | chiffre qui se construit | number_count, number_pop, currency_reveal | synchronisée au chiffre | impact |
| `statistic` | graphique animé | bar_animation, line_animation, chart_growth | statique | montée subtile |
| `comparison` | écran partagé / graphique de comparaison | comparison_graph | statique | — |
| `quote` | carte citation | quote_card | statique | — |
| `proof` | document + caméra + surlignage | document_highlight, document_zoom, source_reveal | push + pan | papier / clic |
| `location` | carte animée | map_zoom, location_pin, city_zoom | large → serré | mouvement subtil |
| `process` | animation par étapes | timeline_event, word_reveal | statique | clics |
| `contradiction` | rupture : coupe franche, énoncé | full_screen_statement | statique | la musique se retire |
| `revelation` | changement de rythme + silence + impact + révélation | impact_reveal, glitch_reveal, full_screen_statement | punch-in | silence puis impact (+ riser) |
| `aftermath` | respiration, plan plus lent | slow_zoom | mouvement lent | musique qui revient |
| `chapter` | carton de chapitre | chapter_card | statique | changement musical |
| `conclusion` | rappel visuel + ralentissement contrôlé | slow_push, callback | pull-out | la musique se résout |

- **GRAM-01** · avertissement · AUTO — Le traitement suit la grammaire par défaut de l'intention ; tout écart porte une justification (`reason`).
- **GRAM-02** · avertissement · REVUE — Aucune animation n'est choisie parce qu'elle existe : la sélection part de l'intention, jamais de l'effet.
- **GRAM-03** · avertissement · AUTO — Un chiffre clé prononcé par la voix apparaît à l'écran, synchronisé à ±6 images du mot.
- **GRAM-04** · conseil · HEUR — Un fait simple (`fact`, `context`) reste sobre : pas de typographie plein écran, intensité `subtle`.

---

## 5. Rythme et durée des plans (RHY)

Le montage varie naturellement. Exemple de respiration d'un chapitre :

```
FAST FAST MEDIUM SLOW SLOW BUILD FAST REVELATION (silence) AFTERMATH FAST
```

Classes de durée : **rapide** < 2,5 s · **moyen** 2,5–4 s · **lent** > 4 s.

- **RHY-01** · avertissement · AUTO — Les plans du hook durent de 1,5 à 2,5 s.
- **RHY-02** · avertissement · HEUR — Les plans du corps durent en général de 2,5 à 4 s.
- **RHY-03** · avertissement · AUTO — Jamais plus de 4 s sans changement visuel (mouvement, nouvel élément, coupe), sauf plan long intentionnel (RHY-04).
- **RHY-04** · avertissement · AUTO — Un plan long intentionnel (> 4 s) est marqué `hold` avec sa raison (information à lire, respiration après une révélation, tension qui monte, révélation préparée) et ne dépasse pas 8 s hors séquence vidéo continue.
- **RHY-05** · avertissement · HEUR — Pas plus de 5 plans consécutifs dans la même classe de durée.
- **RHY-06** · conseil · REVUE — Dans un chapitre, le rythme accélère vers la révélation et respire après.
- **RHY-07** · avertissement · HEUR — Un texte à l'écran reste au moins (nombre de mots ÷ 3) + 0,5 s.
- **RHY-08** · avertissement · AUTO — Une coupe ne tombe pas au milieu d'un mot prononcé : elle tombe au début d'un mot ou dans un silence (tolérance 2 images).
- **RHY-09** · conseil · REVUE — Après une révélation majeure, un ou deux plans plus lents (aftermath) avant de relancer.

---

## 6. Hiérarchie visuelle (HIER)

Chaque plan déclare ce qui compte :

```json
"visualHierarchy": { "primary": "document", "secondary": "highlight", "background": "dark texture" }
```

- **HIER-01** · bloquant · AUTO — Chaque plan déclare `visualHierarchy.primary` ; `secondary` et `background` sont facultatifs.
- **HIER-02** · avertissement · HEUR — Un seul élément porte le mouvement principal à un instant donné : si le secondaire s'anime, le primaire reste calme, et inversement.
- **HIER-03** · avertissement · HEUR — Au plus un élément dominant en couleur d'accent (jaune) et un élément rouge par plan.
- **HIER-04** · avertissement · REVUE — L'arrière-plan ne concurrence pas le primaire : fond sombre, flou ou texture derrière le texte et les documents.
- **HIER-05** · avertissement · HEUR — Au plus 3 éléments informatifs simultanés à l'écran, sous-titres exclus.
- **HIER-06** · avertissement · AUTO — Texte et éléments clés restent dans les 90 % centraux de l'image ; la bande basse est réservée aux sous-titres.

---

## 7. Langage caméra (CAM)

Mouvements disponibles et leur raison d'être :

| Mouvement | Sert à |
|---|---|
| static | laisser lire, stabilité, autorité |
| wide / establishing | situer, donner l'échelle |
| medium | présenter un sujet |
| close-up / extreme close-up | isoler un détail important |
| push-in / slow push | concentrer l'attention, tension lente |
| pull-out | révéler le contexte, conclure |
| pan-left / pan-right / tilt | parcourir (document, paysage, liste) |
| tracking | suivre un sujet, un trajet |
| parallax / depth zoom | donner du volume à une photo |
| punch-in / punch-out | accent brutal : révélation, chiffre, rupture |
| overhead / POV | point de vue, immersion |

- **CAM-01** · avertissement · REVUE — Tout mouvement a une raison (révéler, guider le regard, créer une tension, donner l'échelle) ; sinon le plan est statique.
- **CAM-02** · avertissement · AUTO — Un seul mouvement de caméra par plan ; seule exception : push + pan sur un document.
- **CAM-03** · avertissement · AUTO — Amplitudes : zoom ou push lent de 5 à 10 % sur la durée du plan ; punch-in 100 → 112 → 100 % ; pan d'au plus 15 % de la largeur.
- **CAM-04** · conseil · REVUE — Correspondances par défaut : détail important → gros plan ; révélation → punch-in ; lieu → plan large + carte ; document → push lent + pan ; moment émotionnel → mouvement ralenti ; chiffre → mouvement synchronisé avec son apparition.
- **CAM-05** · avertissement · HEUR — Pas de mouvement rapide pendant la lecture d'un texte de plus de 8 mots.
- **CAM-06** · avertissement · HEUR — Pas deux plans consécutifs avec le même mouvement dans le même sens, sauf continuité de mouvement voulue.
- **CAM-07** · avertissement · AUTO — `camera_shake` est réservé à un impact ou un conflit, dure au plus 0,5 s et apparaît au plus 3 fois par vidéo.

---

## 8. Typographie cinétique (TYPO)

La typographie est une image éditoriale. La hiérarchie typographique reflète l'importance narrative :

```
THE        petit
REAL       grand
BUSINESS   le plus grand
```

- **TYPO-01** · avertissement · REVUE — Taille, graisse, position et opacité traduisent l'importance des mots ; le mot le plus important est le plus visible.
- **TYPO-02** · avertissement · AUTO — Un énoncé plein écran compte au plus 12 mots (idéal 3 à 7) ; au-delà, le découper en plusieurs plans.
- **TYPO-03** · avertissement · AUTO — Au plus 2 mots mis en valeur par énoncé.
- **TYPO-04** · avertissement · AUTO — Les mots mis en valeur figurent dans le texte du plan et sont prononcés pendant le plan.
- **TYPO-05** · avertissement · HEUR — L'apparition des mots suit la voix à ±3 images.
- **TYPO-06** · avertissement · AUTO — Taille minimale en 1080p : 48 px pour le texte principal, 32 px pour le texte secondaire.
- **TYPO-07** · conseil · REVUE — Une famille de police (Inter par défaut), au plus deux graisses par plan, capitales réservées aux énoncés courts.

---

## 9. Motion design (MOT)

- **MOT-01** · avertissement · REVUE — Le mouvement est la conséquence d'une décision éditoriale : on sait dire ce qu'il fait comprendre.
- **MOT-02** · avertissement · AUTO — Intensité `subtle` par défaut ; `strong` est réservé au hook, aux révélations et au climax, et à au plus 20 % des plans.
- **MOT-03** · avertissement · HEUR — Sur toute fenêtre de 10 plans, au moins 2 plans sans animation de contenu (caméra seule ou image nue) pour laisser respirer.
- **MOT-04** · conseil · REVUE — Entrées en ease-out, sorties en ease-in, ressorts amortis ; un rebond visible est réservé au pop d'un chiffre ou d'un mot.
- **MOT-05** · bloquant · AUTO — Toute animation est déterministe : fonction du numéro d'image, jamais du temps réel du navigateur.
- **MOT-06** · bloquant · AUTO — Un skill indisponible suit la chaîne skill demandé → repli compatible → repli sûr → version statique ; le rendu n'échoue jamais pour une animation manquante.
- **MOT-07** · conseil · REVUE — Durées indicatives : entrée de texte 0,3–0,6 s, chiffre 0,6–1,2 s, graphique 1–2 s ; l'animation principale finit avant 70 % du plan pour laisser lire.

---

## 10. Transitions (TRANS)

Transitions autorisées : `hard_cut` (défaut), `fade`, `dissolve`, `slide`, `push`, `wipe`, `zoom`, `blur`, `flash`, `glitch`, `film_burn`. `whip` et `zoom_blur` existent pour des séquences très rapides.

- **Transitions spectaculaires** : `zoom`, `zoom_blur`, `whip`, `flash`, `glitch`, `film_burn`.
- **Transitions sobres** : toutes les autres.

- **TRANS-01** · avertissement · REVUE — La coupe franche est la transition par défaut ; toute autre transition a une justification éditoriale.
- **TRANS-02** · avertissement · AUTO — Seules les transitions du registre sont utilisées ; une transition inconnue devient une coupe franche.
- **TRANS-03** · avertissement · AUTO — `glitch` est réservé aux révélations majeures, au plus 3 fois par vidéo.
- **TRANS-04** · avertissement · AUTO — Au plus 25 % des coupes utilisent une transition spectaculaire.
- **TRANS-05** · avertissement · AUTO — Jamais deux transitions spectaculaires consécutives.
- **TRANS-06** · avertissement · AUTO — Pas de transition spectaculaire vers un plan d'intensité `subtle`.
- **TRANS-07** · conseil · AUTO — Durées : fade et dissolve 0,3–0,8 s, slide, push et wipe 0,3–0,5 s, flash 0,2 s au plus ; une transition ne dépasse jamais la moitié du plus court des deux plans (sinon elle est raccourcie).
- **TRANS-08** · conseil · REVUE — Sens des transitions : fade = changement de temps ou de chapitre ; dissolve = lien doux entre deux plans liés ; film_burn = archive, souvenir ; flash = impact ; glitch = rupture, révélation.

---

## 11. Sound design (SND)

Le sound design n'est pas optionnel, et la retenue est la règle.

| Événement | Son par défaut |
|---|---|
| mot-clé qui apparaît | click / pop discret |
| chiffre qui apparaît | impact |
| graphique qui monte | montée subtile |
| révélation | impact + riser |
| glitch | glitch |
| route sur une carte | mouvement subtil |
| document | papier / clic |
| chapitre | whoosh léger ou rien |

- **SND-01** · avertissement · REVUE — Chaque SFX accompagne un événement visuel ou éditorial précis ; aucun SFX décoratif.
- **SND-02** · avertissement · AUTO — Un SFX tombe à ±1 image de l'événement qu'il accompagne (apparition du mot, du chiffre, impact).
- **SND-03** · avertissement · HEUR — Retenue : au plus 3 SFX en 2 s, et en moyenne au plus un SFX pour deux plans sur une fenêtre de 30 s.
- **SND-04** · avertissement · HEUR — Les SFX forts (impact, riser) tombent juste avant ou juste après un mot important, jamais dessus.
- **SND-05** · avertissement · AUTO — Les SFX sont mixés entre −6 et −18 dB sous la voix.
- **SND-06** · bloquant · AUTO — Chaque SFX vient de la sound-library avec sa licence enregistrée (source, identifiant, licence, attribution).
- **SND-07** · avertissement · AUTO — Un SFX requis par la grammaire (révélation, chiffre clé) qui manque est signalé.

---

## 12. Musique (MUS)

États musicaux : `calm`, `build`, `tension`, `reveal`, `aftermath`.

- **MUS-01** · avertissement · AUTO — La voix est normalisée à −16 LUFS intégrés (±1 LU).
- **MUS-02** · avertissement · AUTO — La musique est à environ −18 dB sans voix et entre −18 et −24 dB sous la voix (ducking : attaque 0,2 s, relâche 0,5 s).
- **MUS-03** · avertissement · AUTO — Chaque plan déclare un état musical (`musicState`) ; les changements d'état tombent aux frontières de scène ou sur une révélation.
- **MUS-04** · avertissement · REVUE — La musique monte pendant la construction, se retire ou se coupe avant une révélation majeure et revient après.
- **MUS-05** · avertissement · AUTO — Les indications musicales (cues : début, état, niveau, fondu) sont dans la Timeline JSON.
- **MUS-06** · avertissement · AUTO — Le ducking suit les segments de parole réels, pas la durée du fichier de narration.
- **MUS-07** · conseil · REVUE — On change de morceau au plus aux chapitres ; une boucle n'est jamais audible (bouclage sur la mesure ou fondu).
- **MUS-08** · bloquant · AUTO — Chaque musique a une licence enregistrée.
- **MUS-09** · avertissement · AUTO — Le mix final vise −14 LUFS intégrés (±1 LU), avec un true peak ≤ −1 dBTP : c'est la référence de lecture de YouTube, qui baisse un mix plus fort et ne remonte pas un mix plus faible.

---

## 13. Silence (SIL)

Un monteur professionnel utilise le silence, avec parcimonie.

```
VOIX    « Et c'est là que tout change. »
        0,3–0,6 s de silence contrôlé (music_drop / sfx_drop / ambient_drop)
        IMPACT + RÉVÉLATION
```

Prérequis technique : la narration est découpée en segments positionnés, pour pouvoir insérer un silence sans couper la voix.

- **SIL-01** · conseil · REVUE — Le silence contrôlé (`music_drop`, `sfx_drop`, `ambient_drop`) sert à préparer une révélation majeure, rien d'autre.
- **SIL-02** · avertissement · AUTO — Un silence contrôlé dure de 0,3 à 0,6 s (1 s au plus).
- **SIL-03** · avertissement · AUTO — Au plus un silence contrôlé par chapitre, jamais deux à moins de 60 s d'écart.
- **SIL-04** · avertissement · AUTO — Un silence contrôlé est immédiatement suivi d'un événement fort (impact, révélation visuelle, phrase clé).

---

## 14. Documents (DOC)

Un document n'apparaît jamais comme une capture statique :

```
PDF → établir le document → push lent → zoom vers la zone → surligner la phrase exacte (synchronisé à la voix)
    → le surlignage s'étend → la source apparaît → transition
```

- **DOC-01** · avertissement · AUTO — Un plan document a toujours un mouvement de caméra et/ou un surlignage ; jamais de document statique.
- **DOC-02** · avertissement · REVUE — Un document suit la séquence : établir, mouvement, zoom vers la zone utile, surlignage de la phrase exacte, source.
- **DOC-03** · avertissement · AUTO — Le surlignage démarre à ±3 images du premier mot correspondant prononcé.
- **DOC-04** · avertissement · HEUR — Au moment du surlignage, la phrase est lisible : texte d'au moins 36 px à l'écran (zoom suffisant).
- **DOC-05** · avertissement · AUTO — Un document utilisé comme preuve affiche sa source (nom, date).
- **DOC-06** · bloquant · REVUE — Jamais de faux document : le document est réel et fourni ; sinon, l'IA émet une demande d'asset.

---

## 15. Graphiques (CHART)

Un graphique raconte : on ne montre pas `$10M $20M $30M`, on construit `0 → 10 → 20 → 30` avec la voix.

- **CHART-01** · avertissement · REVUE — Un graphique porte une seule idée : une évolution, un écart, un classement.
- **CHART-02** · avertissement · AUTO — Les valeurs se construisent progressivement et la valeur clé arrive quand elle est prononcée (±6 images).
- **CHART-03** · avertissement · AUTO — Les barres partent de zéro ; unité et titre sont présents.
- **CHART-04** · avertissement · AUTO — Au plus 7 barres ou catégories, 3 séries, 6 parts de camembert.
- **CHART-05** · avertissement · HEUR — La valeur clé est en jaune, les autres en neutre ; le rouge est réservé à une perte ou une valeur négative.
- **CHART-06** · bloquant · AUTO — Les données d'un graphique sont sourcées.

---

## 16. Cartes (MAP)

Une carte est une scène de cinéma, synchronisée avec la narration.

| Récit | Traitement |
|---|---|
| ville | zoom vers la ville |
| pays | mise en évidence du pays |
| expansion | épingles successives |
| voyage | route animée |
| réseau | carte + lignes de connexion |

- **MAP-01** · avertissement · REVUE — Une carte commence par un plan d'établissement large puis se dirige vers le sujet.
- **MAP-02** · avertissement · AUTO — Les lieux apparaissent un par un, synchronisés avec leur mention dans la voix.
- **MAP-03** · avertissement · AUTO — Au plus 8 libellés simultanés, d'au moins 32 px.
- **MAP-04** · avertissement · AUTO — Les mouvements de carte restent fluides : jamais plus de 2 niveaux de zoom par seconde.
- **MAP-05** · bloquant · AUTO — L'attribution des données cartographiques est visible quand leur licence l'exige.

---

## 17. Sous-titres (CAP)

- **CAP-01** · avertissement · AUTO — Dans le rendu final, les sous-titres sont synchronisés au mot à partir d'une transcription ou d'un alignement, jamais estimés.
- **CAP-02** · avertissement · AUTO — Au plus 2 lignes et 42 caractères par ligne.
- **CAP-03** · avertissement · AUTO — Pas de sous-titres quand le même texte est déjà à l'écran (typographie plein écran, carton, titre du plan).
- **CAP-04** · avertissement · AUTO — Les sous-titres ont un contraste suffisant (plaque ou ombre) et aucun élément graphique n'entre dans leur zone.
- **CAP-05** · conseil · REVUE — Un mot des sous-titres n'est coloré que s'il est aussi un mot mis en valeur du plan.

---

## 18. Couleur (COL)

Palette de marque : fond `#121212` · accent `#FFC72C` · alerte `#DA291C` · texte `#FFFFFF`.

- **COL-01** · avertissement · AUTO — Les éléments graphiques utilisent la palette de marque.
- **COL-02** · avertissement · AUTO — Le rouge est réservé aux conflits, dangers, événements négatifs, avertissements et révélations critiques ; jamais décoratif.
- **COL-03** · conseil · REVUE — Le jaune désigne l'élément le plus important du plan.
- **COL-04** · conseil · REVUE — L'étalonnage reste cohérent à l'intérieur d'une scène (pas de saut de température de couleur entre deux plans consécutifs).

---

## 19. Contrôle des répétitions (REP)

Le gestionnaire de répétitions suit l'usage récent des animations, transitions, SFX, mouvements de caméra, traitements typographiques et changements musicaux.

- **REP-01** · avertissement · AUTO — Un même skill au plus 3 fois sur 10 plans ; au-delà, prendre une alternative de la même catégorie (keyword_pop → word_reveal, scale_text, mask_reveal).
- **REP-02** · avertissement · AUTO — Une même transition autre que la coupe franche au plus 2 fois sur 10 coupes.
- **REP-03** · avertissement · AUTO — Un même SFX au plus 3 fois par minute.
- **REP-04** · avertissement · AUTO — Un même mouvement de caméra au plus sur 3 plans consécutifs.
- **REP-05** · avertissement · AUTO — Un même traitement typographique au plus sur 2 plans typographiques consécutifs.
- **REP-06** · conseil · AUTO — Au plus un changement d'état musical toutes les 20 s, hors révélation.

---

## 20. Contraste visuel (VAR)

Le langage visuel respire : image, texte, document, graphique, carte, image, énoncé plein écran, vidéo…

- **VAR-01** · avertissement · AUTO — Au plus 3 plans consécutifs du même type visuel, sauf séquence intentionnelle marquée (montage d'archives par exemple).
- **VAR-02** · avertissement · HEUR — Toute fenêtre de 10 plans contient au moins 3 types visuels différents.
- **VAR-03** · conseil · REVUE — Après un plan dense (graphique, document), un plan simple (image, énoncé court).

---

## 21. Rappels visuels (CALL)

- **CALL-01** · conseil · AUTO — Le plan éditorial enregistre les motifs visuels (`visualMotifs`), les concepts introduits (`introducedConcepts`) et les candidats au rappel (`callbackCandidates`).
- **CALL-02** · avertissement · REVUE — La conclusion reprend au moins un motif de l'introduction dans un contexte changé (même restaurant, nouveau sens).
- **CALL-03** · conseil · REVUE — Un rappel change le contexte (recadrage, couleur, texte superposé) ; ce n'est pas une simple répétition.

---

## 22. Escalade (ESC)

- **ESC-01** · avertissement · HEUR — L'intensité monte dans un chapitre vers son payoff ; hors hook, le pic d'intensité n'arrive pas avant le dernier tiers du chapitre.
- **ESC-02** · avertissement · REVUE — La révélation la plus forte de la vidéo se trouve dans son dernier tiers.
- **ESC-03** · conseil · REVUE — Chaque chapitre ajoute un niveau d'enjeu : chiffre plus grand, échelle plus large, conséquence plus forte.

---

## 23. Révélations (REV)

Recette : **mise en place → (silence contrôlé) → impact → révélation visuelle → respiration**.

- **REV-01** · avertissement · REVUE — Une révélation suit la recette complète ; la mise en place crée l'attente que la révélation résout.
- **REV-02** · avertissement · AUTO — Une révélation est précédée d'une mise en place (`setup` ou `contradiction`) dans la même scène.
- **REV-03** · avertissement · AUTO — Au plus une révélation majeure par chapitre et jamais deux à moins de 90 s d'écart.
- **REV-04** · avertissement · HEUR — Avant la révélation, le rythme se rompt : plan plus long ou plus calme, ou musique qui se retire.
- **REV-05** · avertissement · AUTO — Une révélation est suivie d'au moins un plan de preuve ou de respiration avant le sujet suivant.

---

## 24. Chapitres (CHAP)

- **CHAP-01** · avertissement · AUTO — Un carton de chapitre sur fond noir dure de 1 à 1,5 s.
- **CHAP-02** · avertissement · AUTO — Un titre de chapitre compte au plus 6 mots.
- **CHAP-03** · conseil · AUTO — Un changement d'état musical accompagne chaque chapitre.
- **CHAP-04** · conseil · HEUR — Dans une vidéo de 10 à 20 min, un chapitre dure de 1 à 4 min.
- **CHAP-05** · avertissement · REVUE — Chaque chapitre commence par une question ou un enjeu et finit par une conclusion ou une relance.

---

## 25. Sources, droits et contenus synthétiques (SRC)

- **SRC-01** · bloquant · AUTO — Chaque asset externe enregistre sa source, son identifiant, sa licence, l'autorisation d'usage commercial et l'obligation d'attribution.
- **SRC-02** · bloquant · AUTO — Aucune vidéo YouTube ni aucun asset commercial n'est téléchargé automatiquement sans licence vérifiée ; un asset aux droits incertains n'est pas utilisé.
- **SRC-03** · avertissement · AUTO — Les attributions requises sont listées dans le rapport final (à reprendre dans la description YouTube).
- **SRC-04** · avertissement · AUTO — Si une vidéo générée par IA réaliste est utilisée, le rapport final rappelle l'obligation de déclaration YouTube des contenus altérés ou synthétiques.
- **SRC-05** · bloquant · REVUE — Aucun faux document, aucune fausse citation, aucun faux chiffre : toute preuve affichée est réelle et sourcée.

---

## 26. Qualité technique (TECH)

- **TECH-01** · bloquant · AUTO — Aucun média manquant ou illisible.
- **TECH-02** · bloquant · AUTO — Le plan est structurellement valide (validation ShotPlan sans erreur).
- **TECH-03** · bloquant · AUTO — Aucune image noire non voulue de plus de 2 images (cartons et fondus exclus).
- **TECH-04** · bloquant · AUTO — Les polices sont chargées avant le rendu (aucune police de repli dans le rendu final).
- **TECH-05** · bloquant · AUTO — Aucune saturation audio : true peak ≤ −1 dBTP.
- **TECH-06** · avertissement · AUTO — Le plan final ne contient que des références résolues (skills, transitions, SFX, assets).
- **TECH-07** · bloquant · AUTO — Rendu final en 1920×1080, H.264, 30 i/s (configurable) ; aperçu en 540p.
- **TECH-08** · avertissement · AUTO — Aucun trou sonore non voulu : jamais plus de 1,5 s sous −60 dBFS en dehors des silences contrôlés.
- **TECH-09** · avertissement · AUTO — Une image n'est jamais agrandie de plus de 1,5× à l'écran (couverture du cadre × cadrage × poussée de caméra) : au-delà, elle paraît floue.

---

## 27. Exemples de bonnes décisions

**Hook — « McDonald's n'est pas une entreprise de burgers. »**

```yaml
- shot: hook_01
  editorialIntent: hook
  importance: 5
  reason: "Poser la contradiction qui porte toute la vidéo, en une phrase."
  visualHierarchy: { primary: "énoncé", background: "restaurant flouté" }
  camera: punch-in            # CAM-04 : révélation/accent → punch-in
  motionSkill: keyword_pop    # « burger » seul mot mis en valeur (TYPO-03)
  duration: 2.2 s             # RHY-01
  sfx: impact discret à l'apparition de « burger » (SND-02)
  transition: hard_cut        # TRANS-01
```

**Preuve — juste après l'affirmation « 61 % de ses revenus viennent des franchisés ».**

```yaml
- shot: proof_report
  editorialIntent: proof
  reason: "Prouver le chiffre immédiatement après l'avoir affirmé (STORY-05)."
  visualHierarchy: { primary: "rapport annuel", secondary: "ligne surlignée", background: "texture sombre" }
  camera: slow push + pan vers la ligne       # CAM-02 : seule combinaison autorisée
  motionSkill: document_highlight             # surlignage calé sur « franchisés » (DOC-03)
  hold: "laisser lire la phrase surlignée"    # RHY-04 : 5 s justifiées
  source: "McDonald's Annual Report 2023"     # DOC-05
  sfx: papier discret à l'établissement
```

**Révélation — « Le vrai business, c'est l'immobilier. »**

```
plan précédent plus calme, la musique se retire (REV-04, MUS-04)
0,4 s de silence contrôlé (SIL-02)
impact + « THE REAL BUSINESS » : THE petit, REAL grand, BUSINESS le plus grand (TYPO-01)
punch-in 100 → 112 → 100 % (CAM-03)
plan suivant : carte des restaurants, épingles une par une avec la voix (MAP-02) = aftermath + escalade
```

**Conclusion.** La photo du restaurant de l'intro revient, recadrée sur le terrain, avec « PROPRIÉTAIRE » en surimpression. C'est un rappel dans un contexte changé (CALL-02), avec un pull-out lent et une musique qui se résout.

## 28. Exemples de mauvaises décisions

| Décision | Pourquoi c'est mauvais | Règles |
|---|---|---|
| Un glitch sur chaque changement de sujet | Le spectaculaire devient du bruit, les vraies révélations perdent leur force | TRANS-03, TRANS-04, TRANS-05 |
| `keyword_pop` sur 8 plans d'affilée | Le montage paraît algorithmique | REP-01, VAR-01 |
| Rapport annuel affiché 5 s sans mouvement ni surlignage | Capture statique, le spectateur ne sait pas quoi lire | DOC-01, RHY-03 |
| Voix « argent » → billets qui tombent en stock | Illustration littérale, aucune information | STORY-04 |
| Chiffre « 61 % » annoncé, graphique affiché 2 s plus tard | Désynchronisé, l'impact est perdu | GRAM-03, CHART-02 |
| Impact + whoosh + riser sur chaque plan | Surcharge sonore, fatigue | SND-01, SND-03 |
| Titre en rouge pour « faire ressortir » | Le rouge perd son sens d'alerte | COL-02 |
| Texte de 20 mots en plein écran pendant 2 s | Illisible | TYPO-02, RHY-07 |
| Sous-titres sous un énoncé plein écran identique | Redondance | CAP-03 |
| Révélation sans mise en place | Aucune attente, donc aucun effet | REV-01, REV-02 |
| Document « illustratif » fabriqué pour appuyer un propos | Faux document | DOC-06, SRC-05 |
| Ken Burns identique (zoom avant 20 %) sur toutes les photos | Mouvement sans raison, amplitude excessive, répétition | CAM-01, CAM-03, REP-04 |
