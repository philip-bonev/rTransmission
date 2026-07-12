Това е много чест проблем при работата с Transmission RPC. Ако Rust изпрати директно форматиран низ като "12.5 MB/s", JavaScript ще се затрудни при сортирането, защото за него "2.1 MB/s" ще се окаже „по-голямо“ от "10.5 MB/s" (тъй като символът "2" е по-голям от "1" при текстово сравнение).

Най-чистото и професионално решение, което запазва **Rust като единствен източник на данни**, е Rust да изпраща за всяка клетка **два параметъра в специален обект**:

1. **raw**: Чисто число в байтове (напр. 12582912), което JavaScript използва за **сортиране**.  
2. **formatted**: Красив, готов за четене низ (напр. "12.00 MB/s"), който JavaScript просто **показва на екрана**.

Ето как да пренастроите системата:

## **1\. Бекенд (Rust)**

Вместо обикновен низ, правим функция в Rust, която пресмята размерите и скоростите, и ги пакетира в структура, удобна за JSON сериализация.

`use serde::Serialize;`  
`use std::collections::HashMap;`

`#[derive(Serialize)]`  
`struct CellData {`  
    `raw: u64,           // За сортиране в JS (число)`  
    `formatted: String,  // За показване в HTML (текст)`  
`}`

*`// Помощна функция за превръщане на байтове в красив текст (B, KB, MB, GB)`*  
`fn format_bytes(bytes: u64, is_speed: bool) -> CellData {`  
    `let suffix = if is_speed { "/s" } else { "" };`  
      
    `if bytes >= 1_073_741_824 {`  
        `CellData {`  
            `raw: bytes,`  
            `formatted: format!("{:.2} GB{}", bytes as f64 / 1_073_741_824.0, suffix),`  
        `}`  
    `} else if bytes >= 1_048_576 {`  
        `CellData {`  
            `raw: bytes,`  
            `formatted: format!("{:.2} MB{}", bytes as f64 / 1_048_576.0, suffix),`  
        `}`  
    `} else if bytes >= 1024 {`  
        `CellData {`  
            `raw: bytes,`  
            `formatted: format!("{:.2} KB{}", bytes as f64 / 1024.0, suffix),`  
        `}`  
    `} else {`  
        `CellData {`  
            `raw: bytes,`  
            `formatted: format!("{} B{}", bytes, suffix),`  
        `}`  
    `}`  
`}`

*`// Вътре в цикъла, където обработвате данните от Transmission RPC:`*  
*`// (Примерен торент със скорост 12,5 MB/s и размер 4,2 GB)`*  
`let mut torrent = HashMap::new();`

*`// ID-то винаги си остава просто число/текст`*  
`let id_cell = CellData { raw: 1, formatted: "1".into() };`  
`torrent.insert("id".to_string(), serde_json::to_value(&id_cell).unwrap());`

*`// Форматираме размера (4.2 GB)`*  
`let size_cell = format_bytes(4_509_715_660, false);`  
`torrent.insert("size".to_string(), serde_json::to_value(&size_cell).unwrap());`

*`// Форматираме скоростта на сваляне (12.5 MB/s)`*  
`let speed_cell = format_bytes(13_107_200, true);`  
`torrent.insert("download_speed".to_string(), serde_json::to_value(&speed_cell).unwrap());`

*`// Излъчваме събитието към JS`*  
*`// main_window.emit("row-update", &torrent);`*

## ---

**2\. Фронтенд (JavaScript)**

Сега всяко поле в JavaScript няма да бъде просто текст, а обект от типа { raw: 13107200, formatted: "12.00 MB/s" }.

Променяме JavaScript шаблона така, че да записва чистото число като **data- атрибут** на самата клетка, а красивия текст да слага вътре в нея.

## **Промяна при създаване на ред (createRowElement):**

`function createRowElement(rowData) {`  
  `const tr = document.createElement('tr');`  
  `tr.setAttribute('data-id', rowData.id.raw); // Взимаме raw за ID-то`

  `currentColumns.forEach(col => {`  
    `const td = document.createElement('td');`  
    ``td.className = `cell-${col.id}`;``  
      
    `if (rowData[col.id]) {`  
      `// Записваме суровата стойност в скрит атрибут за нуждите на сортирането`  
      `td.setAttribute('data-raw', rowData[col.id].raw);`  
      `// Показваме красивия текст на потребителя`  
      `td.textContent = rowData[col.id].formatted;`  
    `}`  
      
    `tr.appendChild(td);`  
  `});`

  `return tr;`  
`}`

## **Промяна при обновление на ред (handleRowUpdate):**

*`// Вътре в existingRow блока, където обновяваме клетките:`*  
`currentColumns.forEach(col => {`  
  ``const cell = existingRow.querySelector(`.cell-${col.id}`);``  
  `if (cell && rowData[col.id]) {`  
    `const newRaw = String(rowData[col.id].raw);`  
    `const newFormatted = rowData[col.id].formatted;`  
      
    `// Оптимизация: Обновяваме само ако стойността се е променила реално`  
    `if (cell.getAttribute('data-raw') !== newRaw) {`  
      `cell.setAttribute('data-raw', newRaw);`  
      `cell.textContent = newFormatted;`  
    `}`  
  `}`  
`});`

## **Промяна във функцията за сортиране (sortTableHTML):**

Сега сортирането става невероятно просто и 100% точно, защото вместо да гадаем дали стойността е текст или число, ние директно сравняваме числата в атрибута data-raw\!

`function sortTableHTML() {`  
  `const rowsArray = Array.from(tbody.querySelectorAll('tr'));`  
    
  `rowsArray.sort((a, b) => {`  
    ``const cellA = a.querySelector(`.cell-${currentSortColumn}`);``  
    ``const cellB = b.querySelector(`.cell-${currentSortColumn}`);``  
      
    `// Взимаме суровите числови стойности (байтове, проценти, секунди)`  
    `const rawA = parseFloat(cellA?.getAttribute('data-raw') || '0');`  
    `const rawB = parseFloat(cellB?.getAttribute('data-raw') || '0');`

    `// Сортираме математически чистото число в байтове`  
    `return isAscending ? rawA - rawB : rawB - rawA;`  
  `});`

  `// Преместваме ги в DOM`  
  `rowsArray.forEach(row => tbody.appendChild(row));`  
`}`

## **Защо тази архитектура е перфектна за Transmission?**

1. **Математическа точност**: Торент със скорост 900 KB/s ще се подреди правилно под торент с 1.2 MB/s, защото JS ще сравнява числата 921600 срещу 1258291, а не низовете.  
2. **Всичко е на български от бекенда**: Тъй като текстовете "GB", "MB/s", "KB" се генерират изцяло в Rust, вие контролирате превода и форматирането централизирано.  
3. **Лесно добавяне на нови метрики**: По същия начин можете да добавите време за оставащо сваляне (ETA) — Rust праща оставащи секунди в raw (за сортиране) и "2ч 15м" във formatted (за показване).

Искате ли да разгледаме как да направите **филтриране на торентите** (например бутони за показване само на „Свалящи се“, „Завършени“ или „Всички“), което също е стандартно за Transmission клиентите?