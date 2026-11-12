import { Routes } from "@angular/router";
import { GameComponent } from "./game/game.component";
import { AdminComponent } from "./admin/admin.component";

// Hash-роутинг (withHashLocation): GitHub Pages не делает SPA-fallback,
// а /#/admin и /#/ работают без перезаписей сервера.
export const routes: Routes = [
  { path: "", component: GameComponent },
  { path: "admin", component: AdminComponent },
  { path: "**", component: GameComponent },
];
