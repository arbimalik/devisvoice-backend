# Inspiration Design & Composants UI — DevisVoice

## Stack du site web

- **Framework** : React
- **Style** : Tailwind CSS
- **Typage** : TypeScript
- **Composants** : shadcn/ui

---

## Composants à intégrer

### 1. SplineScene — `@splinetool/react-spline`
Scène 3D interactive pour le hero du site.
- Utilisation : section hero principale
- Objectif : montrer le produit en 3D, pas décorer

### 2. ContainerScroll — `framer-motion`
Animation scroll avec mockup téléphone incliné en 3D.
- Utilisation : section démo de l'app
- Objectif : révéler l'interface mobile au scroll

### 3. VoicePoweredOrb — `ogl`
Orbe WebGL qui réagit à la voix en temps réel.
- Utilisation : remplace le bouton micro actuel dans l'app
- Objectif : élément signature visuel de DevisVoice

### 4. LiquidGlassButton — `@radix-ui/react-slot`
Bouton effet verre liquide pour les CTA.
- Utilisation : boutons d'action principaux sur le site

---

## Dépendances npm à installer

```bash
npm install @splinetool/runtime @splinetool/react-spline framer-motion ogl @radix-ui/react-slot class-variance-authority
```

---

## Direction design générale

- Interface **premium et moderne**
- 3D **légère et purposeful** — la 3D montre le produit, elle ne décore pas
- Mockup iPhone en 3D sur le hero
- Orbe vocal comme **élément signature** de l'app
