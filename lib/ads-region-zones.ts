/**
 * DELIVERY ZONE MAPPING
 * Maps each locality to the operational delivery zone a rider is assigned to.
 * A rider normally opts for one (or a few) zones, so grouping their allocated
 * localities by zone makes it obvious which zones they actually cover, instead
 * of showing a long flat list of individual localities.
 *
 * Source: operations locality->zone sheet.
 */

// Zone -> localities. Kept as arrays for readability; inverted below into a
// normalized lookup for fast, case/spacing-insensitive matching.
const ZONE_LOCALITIES: Record<string, string[]> = {
  'EAST - 1': [
    "Saint Julien d'Hotman", 'Saint Julien Village', 'FUEL', 'Union Flacq', 'Lalmatie', 'Belveder',
    'Brisee Verdiere', "Mare D'Australia", 'Pont Praslin', 'Bon Accueil', 'Grand Bas Fond',
    'Grande Retraite', 'Petite Retraite', 'Laventure', 'Pont Blanc', 'Constance', 'Poste de Flacq',
    "Bras d'Eau", 'La Porte Providence', 'Central Flacq', 'Flacq', 'Plaine De Gersigny', 'Boulet Rouge',
    'Riche Mare', 'Argy', 'La Source Flacq', 'Mare La Chaux', 'Ernest Florent', 'Quatre Cocos',
    'Belle Mare', 'Palmar', "Trou D'Eau Douce", 'Isidore Rose', 'Camp Ithier', 'Bramsthan', 'Bonne Mere',
    'Queen Victoria', 'Ecroignard', 'Caroline', 'Beau Champ', 'Four Seasons Hotel', 'GRSE', 'Deux Freres',
    'Quatre Soeurs', 'Pointe aux Feuilles', 'Grand Sable', 'Petit Sable', 'Bel Air', 'La Lucie Roy',
    'Belle Rose Flacq', 'Clemencia', 'Olivia', 'Kewal Nagar', 'Sebastopol', 'Camp Thorel',
    'Montagne Blanche', 'Sans Souci', 'Melrose', 'Petit Paquet', 'Bel Etang', 'Camp De Masque',
    'Camp De Masque Pave', 'Petite Cabane', 'Medine Camp de Masque', 'Riche Fond', 'Mont Ida',
    'Providence', 'Quartier Militaire', 'Vuillemin',
  ],
  'EAST - 2': [
    'Ebene', 'Ebene Cybercity', 'Residence Cybervillage', 'Tribecca Mall', 'Reduit',
    'University Of Mauritius', 'State House', 'Bagatelle Office Park', 'Bagatelle Mall', 'MBC Moka',
    'Telfair', 'Moka Business Centre', 'Moka', 'Mount ORY', 'Moka Eye Hospital', 'Bocage',
    'Bois Cheri Moka', "L'Agrement", 'Petit Verger', 'Gentilly', 'Helvetia', "Les Allees d'Helvetia",
    "Cote D'Or", "Cote d'Or VRS", 'Gentilly Estate', 'Saint Pierre', 'Kendra', 'Verdun', 'Alma',
    'Circonstance', "L'Avenir", 'Beau Bois', 'La Laura', 'Malenga', 'Ripailles', 'Nouvelle Decouverte',
    "L'Esperance", 'Valetta', "L'Assurance", 'Dagotiere', 'Lower Dagotiere', 'Upper Dagotiere',
  ],
  'EAST - 3': [
    'Belle Rose', 'Boundary', 'Rose Hill', 'Vandermeersch', 'Trefles', 'Stanley', 'Plaisance',
    'Camp Levieux',
  ],
  'PORT LOUIS': [
    'Montebello', 'Soreze', 'Domaine Les Pailles', 'SVICC', 'Pailles', 'Guibies', 'Pailles East',
    'Pailles West', 'Camp Chapelon', 'Plaine Lauzun', 'Jumbo Riche Terre', 'Riche Terre Ind Zone',
    'Riche Terre', 'Jin Fei', 'Le Hochet', 'Terre Rouge', 'Bois Marchand', 'Cite Bois Marchand',
    'Bois Pignolet', 'Baie Du Tombeau', 'Elizabethville', 'St Malo', 'St Joseph',
    'Camp La Boue Terre Rouge', 'Arsenal', 'Bois Rouge', 'Bois Mangue', 'Plaine des Papayes',
    'Morcellement St Andre', 'Balaclava', 'Le Goulet', 'Petit Gamin', 'Pointe Aux Piments',
    'Petite Pointe aux Piments', 'Grande Pointe aux Piments', 'Solitude', 'Triolet', 'Pointe Aux Biches',
    'Trou Aux Biches', 'Mont Choisy', 'Fond du Sac', 'Forbach Branch',
  ],
  ALBION: [
    'GRNW', 'Cite Borstal', 'La Tour Koenig', 'La Tour Koenig Industrial Zone', 'Pointe Aux Sables',
    'Terrasson', 'Petite Riviere', 'Cite Richelieu', 'Richelieu', 'Albion', 'Gros Cailloux',
    'Coromandel', 'Chebel', 'Belle Etoile', 'Beau Bassin', 'Cite Barkly', 'Brown Sequard Hospital',
    'Saint Martin Beau Bassin', 'Mare Gravier', 'Roches Brunes', 'Mont Roches',
  ],
  CUREPIPE: [
    'Malherbes', 'Floreal', 'Cite Loiseau', 'Cite Mangalkhan', 'Curepipe', 'Les Casernes Curepipe',
    'Robinson', 'Camp Caval', 'Trou Aux Cerfs', 'Forest Side', 'Cite Atlee', 'Camp Le Juge',
    'Cite Joachim', 'La Brasserie',
  ],
  PW: [
    'Wooton', 'Belle Rive', 'Dubreuil', 'Belle Terre', 'Cinq Arpents', 'Hermitage', 'Camp Fouquereaux',
    'Highlands', 'Valentina', 'Petit Camp', 'Trianon', 'Pont Fer', 'Couvent De Lorette Road',
    'Cite Malherbes', 'Eau Coulee', 'Allee Brillant', 'Engrais Martial', 'Castel', 'Mesnil', 'St Paul',
    'Phoenix', 'Jumbo Phoenix', 'Closel',
  ],
  VACOAS: [
    'La Marie', 'Morc Pousson', 'Henrietta', 'Glen Park', 'Tres Bon No. 1', 'Tres Bon No. 2',
    'Tres Bon No. 3', 'Tres Bon No. 4', 'Reunion', 'Sadally', 'Quinze Cantons No.1', 'Quinze Cantons No.2',
    'Vacoas', 'Diolle', 'Hollyrood No.1', 'Hollyrood No.2', 'Modern', 'Gymkhana', 'La Caverne',
    'La Caverne No.1', 'La Caverne No.2', 'Visitation', 'Clairfonds No.1', 'Clairfonds No.2',
    'Clairfonds No.3', 'Vingta No. 1', 'Vingta No. 2', 'Vingta No. 3', 'Bonne Terre', 'Solferino No. 1',
    'Solferino No. 2', 'Solferino No. 3', 'Solferino No. 4', 'Solferino No. 5',
  ],
  WEST: [
    'Carreau Lalianne', 'Paillotte', 'Candos', 'Victoria Hospital', 'Cite Kennedy', 'Quatre Bornes',
    'Sodnac', 'St Jean', 'Ollier', 'Berthaud', 'Ligne Berthaud', 'La Louise', 'Bassin', 'Palma',
    'La Source', 'Beau Songes', 'Geoffroy', 'Bambous', 'Bambous Medine', 'La Ferme', 'Cascavelle',
    'Flic En Flac', 'Wolmar', 'La Pirogue', 'Hilton Hotel', 'Sofitel Hotel', 'Taj and Mahadhiva Hotel',
    'Tamarin', 'Tamarin Golf', 'Grande Riviere Noire', 'Black River', 'La Preneuse', 'La Balise Marina',
    'La Balise', 'Petite Riviere Noire', 'Ruisseau Creole Complex', 'Case Noyale', 'La Gaulette',
    'Coteau Raffin', 'Le Morne', 'Le Morne Brabant', 'Le Morne Village', 'Terre 7 Couleurs', 'Chamarel',
    'Camp Madras',
  ],
  TRIOLET: [
    'Cite Valijee', 'Cassis', 'Bain des Dames', 'Les Salines', 'Caudan', 'Caudan Waterfromt', 'La Butte',
    'Venus', 'Bell Village', 'Marie Reine de la Paix', 'Port Louis', 'Line Barracks',
    'Dr. A. G. Jeetoo Hospital', 'Champ De Mars', 'Tranquebar', 'Vallee Pitot', 'Plaine Verte',
    'Camp Yoloff', 'Cite Martial', 'Canal Dayot', 'Croisee Vallee Des Pretes', 'Vallee Des Pretes',
    'Carreau Lalo', 'Cite La Cure', 'La Cure', 'Mer Rouge', 'Quay D', 'Cite Roche Bois', 'Roche Bois',
    'Briquetterie', 'St Croix',
  ],
  GOODLANDS: [
    'Khoyratty', 'Calebasses', 'S.S.R.N.Hospital', 'Pamplemousses', 'Botanical Garden',
    'Morcellement Maison Blanche', 'Mon Gout', 'The Mount', 'Beau Plan', 'Mapou', 'Belle Vue Harel',
    'Labourdonnais', 'Pointe Aux Cannoniers', 'Mont Choisy Shopping Mall', 'La Croisette', 'Grand Bay',
    'Super U Grand Bay', 'La Cuvette', 'Pereybere', "Pointe D'Azur", 'Bain Boeuf', 'Cap Malheureux',
    'Sottise', 'The Vale', 'Lower Vale', 'Upper Vale', 'Union Daruty', 'Petit Raffray', 'Moulin au vent',
    'Trois Bras', 'St Francois North', 'Calodyne', 'Anse La Raie', "Butte a L'Herbe", 'Grand Gaube',
    'Roche Terre', 'Goodlands', 'Mamzelle Jeanne', 'Madame Azor', 'Domaine du Moulin', 'Cottage',
    "L'Esperance Trebuchet", "Poudre D'Or Hamlet", "Poudre D'Or Village", 'Piton', 'Esperance Piton',
    'Bon Espoir', 'Mon Piton', 'DEpinay', 'Ilot', 'Congomah', 'Les Mariannes', 'Notre Dame',
    'Long Mountain', 'Valton', 'Creve Coeur',
  ],
  REMPART: [
    "Ile D'Ambre", 'Panchvati', 'Pointe des Lascars', 'Poste Lafayette', 'Roches Noires',
    'Plaine Des Roches', 'Riviere du Rempart', 'Riverside', 'Mon Loisir', 'Desjardins', 'Amaury',
    'Barlow', 'Belle Vue Maurel', 'Amitie', 'Gokhoola', 'Petite Julie', 'Ville Bague', 'Nicoliere',
  ],
  SOUTH: [
    'Midlands', 'Seizieme Mille', 'Cite Anoushka', 'Nouvelle France', 'La Flora', 'Grand Bois',
    'Camp Bananes', 'Bois Cheri South', 'Riviere Du Poste', 'Mare Tabac', 'Gros Bois', 'Union Park',
    'Cluny', 'Balisson', 'Rose Belle', 'New Grove', 'Gros Billot', 'Mont Fertille', 'Cite Mont Fertile',
    'La Rosa', "Mare D'Albert", "Cite Mare D'Albert", 'Deux Bras', 'Mare Chicose', 'Eau Bleu', 'Bananes',
    'Le Val Nature Park', 'St Hilaire', 'St Hubert', 'Riche en Eau', 'Ferney', 'Old Grand Port',
    'Bois Des Amourettes', 'Anse Jonchée', 'Bambous Virieux', 'Grand Bel Air', 'Riviere Des Creoles',
    'Petit Bel Air', 'Ville Noire', 'Mahebourg', 'Pointe Jerome', "Pointe D'Esny", 'Blue Bay',
    'Beau Vallon', 'SSR International Airport', 'Mon Desert Mon Tresor', 'Le Chaland', 'La Cambuse',
    'Camp Carol', 'Le Bouchon', 'Carreau Accacia', 'Carreau Esnouf', 'Plaine Magnien', 'Union Vale',
    'Trois Boutiques', 'Malakoff', 'Plein Bois', "L'Escalier", 'Benares', 'Batimarais', 'Camp Diable',
    'Riche Bois', 'Britannia', 'Riviere Dragon', 'Tyack', 'Cite Tyack', 'Riviere Des Anguilles',
    'Union Ducray', 'St Aubin', 'Souillac', 'Gris Gris', 'Cite Gris Gris', 'Surinam', 'Riambel',
    'African Town Squatters', 'Pomponette', 'Saint Felix', 'Chemin Grenier', 'Chamouny', 'Mare Anguilles',
    'Mont Blanc', 'Riviere des Galets', 'Bel Ombre', 'Saint Martin Bel Ombre', 'Baie Du Cap', 'Choisy',
    'La Prairie', 'Grand Bassin',
  ],
}

// Normalize a locality name for matching: lowercase, collapse whitespace,
// strip punctuation so "Cote d'Or VRS" and "cote dor vrs" both match.
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Build the inverted lookup once at module load.
const LOCALITY_TO_ZONE = new Map<string, string>()
for (const [zone, localities] of Object.entries(ZONE_LOCALITIES)) {
  for (const loc of localities) LOCALITY_TO_ZONE.set(normalize(loc), zone)
}

/** Ordered zone list for stable display (north-to-south-ish operational order) */
export const ZONE_ORDER = [
  'PORT LOUIS', 'TRIOLET', 'GOODLANDS', 'REMPART', 'ALBION', 'WEST',
  'EAST - 1', 'EAST - 2', 'EAST - 3', 'PW', 'CUREPIPE', 'VACOAS', 'SOUTH',
]

/** Zone for a single locality, or null if it isn't mapped */
export function zoneForLocality(locality: string): string | null {
  if (!locality) return null
  return LOCALITY_TO_ZONE.get(normalize(locality)) ?? null
}

export interface ZoneGroup {
  zone: string
  /** localities within this zone that the rider covers */
  localities: string[]
}

/**
 * Group a rider's flat locality list into delivery zones.
 * Returns zones sorted by ZONE_ORDER, plus an "Other" bucket (zone = null-safe
 * label) for any localities not found in the mapping so nothing is hidden.
 */
export function groupLocalitiesByZone(localities: string[]): { zones: ZoneGroup[]; unmatched: string[] } {
  const byZone = new Map<string, string[]>()
  const unmatched: string[] = []
  for (const loc of localities) {
    const zone = zoneForLocality(loc)
    if (!zone) {
      unmatched.push(loc)
      continue
    }
    const arr = byZone.get(zone) || []
    arr.push(loc)
    byZone.set(zone, arr)
  }
  const zones: ZoneGroup[] = Array.from(byZone.entries())
    .map(([zone, locs]) => ({ zone, localities: locs.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => {
      const ai = ZONE_ORDER.indexOf(a.zone)
      const bi = ZONE_ORDER.indexOf(b.zone)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  return { zones, unmatched: unmatched.sort((a, b) => a.localeCompare(b)) }
}
