import { Component, OnInit } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { SupabaseService } from "./core/supabase.service";

@Component({
  standalone: true,
  imports: [RouterOutlet],
  selector: "app-root",
  template: `<router-outlet></router-outlet>`,
})
export class AppComponent implements OnInit {
  constructor(private sb: SupabaseService) {}
  ngOnInit() {
    // сердцебиение «я онлайн» (зелёные точки в рейтинге) — на всех экранах
    this.sb.startPresence();
  }
}
