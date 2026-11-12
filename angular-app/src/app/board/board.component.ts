import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ScoreRow } from "../core/supabase.service";

/**
 * Таблица рекордов: топ-10, подсветка своей строки, зелёная точка «онлайн»,
 * ▶ у топ-3 — просмотр реплея. (Порт boardHTML() из single-file версии.)
 */
@Component({
  standalone: true,
  imports: [CommonModule],
  selector: "app-board",
  template: `
    <div *ngIf="error" class="bEmpty">{{ error }}</div>
    <div *ngIf="!error && rows.length === 0" class="bEmpty">Пока пусто — стань первым! 🎄</div>
    <ng-container *ngIf="!error">
      <div class="bRow" *ngFor="let e of rows.slice(0, 10); let i = index; trackBy: track"
           [class.me]="i === meIdx">
        <span class="bRank">{{ i + 1 }}.</span>
        <span class="bName">{{ e.name }}</span>
        <span class="bOn" *ngIf="e.client_id && online.has(e.client_id)" title="сейчас онлайн"></span>
        <span class="bScore">{{ e.score }}</span>
        <button class="bPlay" *ngIf="e.id && i < 3" title="Смотреть реплей" (click)="open.emit(e.id)">▶</button>
      </div>
    </ng-container>
  `,
})
export class BoardComponent implements OnChanges {
  @Input() rows: ScoreRow[] = [];
  @Input() online: Set<string> = new Set();
  @Input() myKey = "";
  @Input() error = "";
  @Output() open = new EventEmitter<number | string>();

  meIdx = -1;   // своя строка подсвечивается только первая из совпадений

  ngOnChanges(_: SimpleChanges) {
    this.meIdx = -1;
    if (this.myKey) {
      const top = this.rows.slice(0, 10);
      for (let i = 0; i < top.length; i++) {
        if (top[i].name + "|" + top[i].score === this.myKey) { this.meIdx = i; break; }
      }
    }
  }
  track = (_: number, e: ScoreRow) => e.name + "|" + e.score + "|" + (e.client_id || "");
}
