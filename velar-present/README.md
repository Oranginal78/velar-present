# VELAR Present

Glisse une prez (export web), récupère un lien VELAR à envoyer au client.

- **Admin** : `https://present.velar-studio.com/admin-<ADMIN_TOKEN>` — lien secret, sans mot de passe (à garder en favori, ne pas partager). Sans `ADMIN_TOKEN`, l'admin reste sur `/admin` avec le mot de passe `ADMIN_PASSWORD`.
- **Lien client** : `https://present.velar-studio.com/<lien>` — plein écran, mobile, aperçu VELAR dans WhatsApp
- **Formats** : `.html` (export « Web page ») ou `.zip` (le html + ses vidéos/images à côté)

## Mise en ligne sur Render (une seule fois)

1. Mets ce dossier sur GitHub (nouveau repo `velar-present`, puis « uploading an existing file » et tu glisses tout le contenu du dossier).
2. Sur Render : **New → Blueprint** → choisis le repo. Render lit `render.yaml` et crée le service avec son disque de stockage.
3. Quand il le demande, saisis `ADMIN_PASSWORD` (ton mot de passe admin).
4. Dans le service : **Settings → Custom Domains → Add** `present.velar-studio.com`, puis ajoute chez ton registrar le **CNAME** `present` → la valeur `….onrender.com` que Render affiche.

Le stockage des prez nécessite une instance Render payante (les instances gratuites n'ont pas de disque persistant).

## Utilisation

1. Exporte ta prez en page web (Claude : menu Partager → Export → Web page).
2. S'il y a des vidéos à part : mets le html et les vidéos dans un dossier, compresse-le en `.zip`.
3. Ouvre `/admin`, glisse le fichier, choisis le titre et le lien (`sumeria`), **Mettre en ligne**.
4. **Copier le lien** → WhatsApp.

Cocher « Remplacer si existe » met à jour une prez en gardant le même lien.
