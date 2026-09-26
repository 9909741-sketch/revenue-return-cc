// Сериализация массива объектов в CSV для выгрузки отчётов (критерий приёмки №10:
// в CSV должны быть те же цифры, что и на экране — поэтому CSV строится из тех же
// вычисленных строк, что и JSON-ответ для экрана, см. server/src/services/reportService.ts).
import { stringify } from "csv-stringify/sync";

export function rowsToCsv(rows: Record<string, string | number>[]): string {
  const csvBody = stringify(rows, { header: true, delimiter: ",", quoted: true });
  // BOM для корректного отображения кириллицы при открытии в Excel.
  return "﻿" + csvBody;
}
