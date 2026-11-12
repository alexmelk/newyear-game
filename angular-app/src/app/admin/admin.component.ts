import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { SupabaseService, ScoreRow } from "../core/supabase.service";
import { VERSION } from "../core/config";

/**
 * Мини-админка модерации (порт admin.html): список рекордов с жалобами 🚨,
 * скрытие/показ, «✓ проверить» (сброс флага+жалоб), удаление, просмотр реплея.
 * Доступ — по паролю администратора (проверяет Edge-функция admin).
 */
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  selector: "app-admin",
  template: `
  <div class="admWrap">
    <h1>🛠 Модерация рекордов · 🎄 Новогодний бегун <span class="admVer">v{{ version }}</span></h1>
    <div class="bar">
      <input [(ngModel)]="pass" type="password" placeholder="Пароль администратора"
             (keydown.enter)="refresh()">
      <button (click)="refresh()">🔄 Обновить</button>
      <a routerLink="/">⬅ к игре</a>
      <span [class.err]="statusErr">{{ status }}</span>
    </div>
    <table>
      <thead><tr><th>Дата</th><th>Имя</th><th>Очки</th><th>Реплей</th><th>Статус</th><th>Действия</th></tr></thead>
      <tbody>
        <tr *ngIf="!rows.length"><td colspan="6" class="empty">— {{ rowsEmptyMsg }} —</td></tr>
        <tr *ngFor="let r of rows" [class.hiddenRow]="r.hidden">
          <td>{{ fmtDate(r.created_at || '') }}</td>
          <td>{{ r.name }}</td>
          <td class="sc">{{ r.score }}</td>
          <td>{{ r.replay_bytes ? (r.replay_bytes / 1024 | number:'1.0-0') + 'KB' : '—' }}</td>
          <td>
            <span class="badge" *ngIf="r.reports">🚨 {{ r.reports }}</span>
            <span class="badge" *ngIf="r.suspicious">⚠ подозр.</span>
            <span class="badge" *ngIf="r.hidden">🚫 скрыт</span>
            <span class="badge ok" *ngIf="!r.hidden">в борде</span>
          </td>
          <td class="acts">
            <button class="sec" *ngIf="r.replay_bytes" (click)="view(r.id!)">▶</button>
            <button class="sec" (click)="act(r, r.hidden ? 'show' : 'hide')">{{ r.hidden ? '👁' : '🚫' }}</button>
            <button class="sec" *ngIf="r.suspicious || r.reports" (click)="act(r, 'verify')">✓</button>
            <button class="sec" (click)="act(r, 'del')">✖</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="note">
      ▶ — открыть реплей в игре (топ-3 тоже видят эту кнопку на общем борде).<br>
      ⚠ «подозрительный» — аномальная плотность очков (&gt;35/сек); «✓ проверить» снимает флаг и обнуляет жалобы, если вручную всё ок.<br>
      🚨 — жалобы от игроков («Читер!» при просмотре реплея); записи с жалобами показываются первыми.<br>
      🚫 Скрытые записи не попадают в общий борд, но остаются в базе с реплеем. ✖ — полное удаление.<br>
      Любая запись в борде уже прошла серверную проверку: честный seed раунда, сумма событий = очки,
      3 попадания, время ≤ реальному с момента старта раунда, раунд использован один раз.
    </div>
  </div>
  `,
})
export class AdminComponent implements OnInit {
  version = VERSION;
  pass = "";
  status = "";
  statusErr = false;
  rows: ScoreRow[] = [];
  rowsEmptyMsg = "нужно войти";

  constructor(private sb: SupabaseService) {}
  ngOnInit() {
    this.pass = sessionStorage.getItem("xmasAdminPass") || "";
    if (this.pass) this.refresh();
  }

  fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  }
  private setStatus(t: string, err = false) { this.status = t; this.statusErr = err; }

  async refresh() {
    sessionStorage.setItem("xmasAdminPass", this.pass);
    if (!this.pass) { this.setStatus("Введите пароль"); return; }
    this.setStatus("Загружаю…");
    try {
      const rows: ScoreRow[] = await this.sb.admin("list", undefined, this.pass);
      rows.sort((a, b) => (b.reports || 0) - (a.reports || 0));   // с жалобами — наверху
      this.rows = rows;
      this.rowsEmptyMsg = "пусто";
      this.setStatus("Записей: " + rows.length);
    } catch (e: any) {
      this.setStatus("Ошибка: " + e.message, true);
      if (e.message === "wrong password") { this.rows = []; this.rowsEmptyMsg = "неверный пароль"; }
    }
  }

  view(id: number | string) { window.open("?replay=" + encodeURIComponent(id), "_blank"); }

  async act(r: ScoreRow, a: string) {
    try {
      if (a === "view") { this.view(r.id!); return; }
      if (a === "del" && !confirm("Удалить запись навсегда?")) return;
      await this.sb.admin(a === "del" ? "delete" : a, r.id, this.pass);
      await this.refresh();
    } catch (e: any) { this.setStatus("Ошибка: " + e.message, true); }
  }
}
