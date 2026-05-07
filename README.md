# Karakeep - Vibe (Android Optimized Fork)

This is a personal fork of the [Karakeep](https://github.com/karakeep-app/karakeep) project, specifically focused on the Android mobile experience.

**Purpose**: The primary goal of this repository is to enhance the Android application with features like offline queuing for shared links and a simplified tagging menu for quick organization. It is intended for personal use.

## Credits

All credit for the main application and server goes to the incredible [Karakeep team and contributors](https://github.com/karakeep-app/karakeep). 

Karakeep (previously Hoarder) is a self-hostable bookmark-everything app with a touch of AI for the data hoarders out there.

For official features, server installation instructions, and contributing guidelines, please refer to the [official repository](https://github.com/karakeep-app/karakeep).

---

## Enhanced Mobile Features

This fork introduces several improvements to the mobile app:
- **Offline Queuing**: Share links or text to the app even when you don't have an internet connection. They will be saved locally and synchronized automatically once you are back online.
- **Quick Tagging Menu**: When sharing content, a simplified menu allows you to quickly assign a title and pick from a fixed set of personal tags (`just`, `diy`, `fit`, `3d`, `home`, `bike`, `electronics`, `science`).
- **Optimized Workflow**: The share activity closes automáticamente y te devuelve a tu aplicación anterior tras un guardado exitoso, agilizando mucho el proceso.

## Development

This repository has been stripped down to focus only on the mobile application and its required dependencies.

- **Frontend**: React Native, Expo, Tailwind CSS (NativeWind)
- **Tooling**: pnpm, Turborepo

To start development on the mobile app:
```bash
pnpm install
cd apps/mobile
pnpm android
```
