# Génère les icônes de l'application (public/icone-*.png). À relancer seulement pour changer le dessin :
#   python3 scripts/icones.py
from PIL import Image, ImageDraw

def icone(taille: int, chemin: str) -> None:
    f = 4  # dessin en grand puis réduction : bords lisses
    t = taille * f
    img = Image.new('RGBA', (t, t), '#2e7d32')
    d = ImageDraw.Draw(img)
    # Contenu dans la zone sûre des icônes « maskable » (cercle de 80 % au centre).
    m = t * 0.24
    parcelle = [(m, t * 0.40), (t * 0.62, m), (t - m, t * 0.58), (t * 0.40, t - m)]
    d.polygon(parcelle, fill='#a5d6a7')
    d.line(parcelle + [parcelle[0]], fill='white', width=int(t * 0.035), joint='curve')
    for x, y in parcelle:
        r = t * 0.045
        d.ellipse((x - r, y - r, x + r, y + r), fill='white')
    x, y = parcelle[1]
    r = t * 0.07
    d.ellipse((x - r, y - r, x + r, y + r), fill='#d500f9', outline='white', width=int(t * 0.02))
    img.resize((taille, taille), Image.LANCZOS).save(chemin)

for taille in (192, 512):
    icone(taille, f'public/icone-{taille}.png')
icone(180, 'public/icone-apple.png')
