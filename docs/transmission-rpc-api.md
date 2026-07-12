Свързването на приложението с **Transmission RPC API** прави избраната архитектура още по-наложителна и правилна.Transmission RPC връща данните за торентите точно по този начин – като масив от обекти, където в заявката (torrent-get) вие изрично указвате кои полета (fields) искате да изтеглите (напр. id, name, status, rateDownload, percentDone \[1\]).

Тъй като Rust така или иначе трябва да прави заявки към Transmission и да филтрира полетата, няма никакъв смисъл JavaScript да обработва излишни данни.

Ето как да структурирате финалната логика, съобразена със спецификата на Transmission:

## **1\. Архитектурен модел в Rust**

В Rust дефинираме списък с всички поддържани полета от Transmission RPC. Когато потребителят избере колони, Rust прави две неща:

1. Изпраща конфигурацията (с описания на български) към JS.  
2. При всяка секунда изпраща RPC заявка към Transmission, като изисква **само id \+ избраните от потребителя полета**.

```rust
// src-tauri/src/lib.rs
use serde::Serialize;  
use std::collections::HashMap;  
use std::time::Duration;  
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]  
struct ColumnConfig {  
    id: String,  
    description: String,  
}

*// Примерна функция, симулираща получаване на данни от Transmission RPC*  
async fn fetch_from_transmission(fields: &[String]) -> Vec<HashMap<String, String>> {  
    // В реалния код тук ще използвате HTTP клиент (напр. reqwest) към Transmission RPC.  
    // Заявката ви ще изглежда така: { "method": "torrent-get", "arguments": { "fields": fields } }  
      
    let mut torrent1 = HashMap::new();  
    torrent1.insert("id".into(), "1".into());  
      
    // Пълним динамично само поисканите полета  
    if fields.contains(&"name".into()) { torrent1.insert("name".into(), "Ubuntu Linux ISO".into()); }  
    if fields.contains(&"size".into()) { torrent1.insert("size".into(), "4.2 GB".into()); }  
    if fields.contains(&"progress".into()) { torrent1.insert("progress".into(), "78.4%".into()); }  
    if fields.contains(&"download_speed".into()) { torrent1.insert("download_speed".into(), "12.5 MB/s".into()); }

    vec![torrent1]  
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]  
pub fn run() {  
    tauri::Builder::default()  
        .setup(|app| {  
            let main_window = app.get_webview_window("main").unwrap();

            // Всички възможни Transmission колони с БГ описания  
            let all_columns = vec![  
                ColumnConfig { id: "id".into(), description: "№".into() },  
                ColumnConfig { id: "name".into(), description: "Име на торент".into() },  
                ColumnConfig { id: "size".into(), description: "Размер".into() },  
                ColumnConfig { id: "progress".into(), description: "Прогрес".into() },  
                ColumnConfig { id: "download_speed".into(), description: "Скорост (Сваляне)".into() },  
            ];

            // Потребителски избор в момента (напр. Име, Прогрес и Скорост)  
            let active_columns = vec![  
                all_columns[0].clone(), // id  
                all_columns[1].clone(), // name  
                all_columns[3].clone(), // progress  
                all_columns[4].clone(), // download_speed  
            ];

            // Пращаме конфигурацията към JS при старт  
            let window_clone = main_window.clone();  
            let cols_to_send = active_columns.clone();  
            tauri::async_runtime::spawn(async move {  
                tokio::time::sleep(Duration::from_millis(500)).await;  
                let _ = window_clone.emit("columns-config", &cols_to_send);  
            });

            // Извличаме списък само от ID-тата на полетата за Transmission RPC  
            let rpc_fields: Vec<String> = active_columns.iter().map(|c| c.id.clone()).collect();

            // Фонов таймер (на всяка секунда вика Transmission и праща към JS)  
            tokio::spawn(async move {  
                loop {  
                    tokio::time::sleep(Duration::from_secs(1)).await;  
                      
                    let torrents = fetch_from_transmission(&rpc_fields).await;  
                      
                    for torrent in torrents {  
                        // Пращаме всеки торент като отделно събитие за обновяване на ред  
                        let _ = main_window.emit("row-update", &torrent);  
                    }  
                }  
            });

            Ok(())  
        })  
        .run(tauri::generate_context!())  
        .expect("error while running tauri application");  
}
```

## **2\. Изчистване на изтрити тоrenти във фронтенда (JS)**

Тъй като торентите могат да бъдат изтривани от Transmission (или добавяни нови), в JavaScript се появява един важен детайл: **какво правим, ако даден торент бъде премахнат?**

Ако просто слушаме за обновления, изтритият торент ще "замръзне" в таблицата завинаги. За да решим това без пренаписване на цялата таблица, можем да добавим механизъм за проверка на "актуалност" (Garbage Collection) в JS.

Ето оптимизирания скрипт за фронтенда:

```javascript
import { listen } from '@tauri-apps/api/event';

let currentColumns = [];   
const domRowsCache = new Map(); 

// Пазим времева маркировка (Timestamp) за последното обновяване на всеки ред
const rowLastUpdated = new Map(); 

const theadRow = document.getElementById('table-headers');  
const tbody = document.getElementById('table-body');

// 1. Приемане на колоните от Rust
async fn initColumnsListener() {  
  await listen('columns-config', (event) => {  
    currentColumns = event.payload;  
    theadRow.innerHTML = '';  
    tbody.innerHTML = '';  
    domRowsCache.clear();  
    rowLastUpdated.clear();

    currentColumns.forEach(col => {  
      const th = document.createElement('th');  
      th.textContent = col.description;  
      theadRow.appendChild(th);  
    });  
  });  
}

// 2. Обновяване на редовете от Transmission
async fn initRowListener() {  
  await listen('row-update', (event) => {  
    const torrent = event.payload; // Данни за конкретен торент  
    if (!torrent.id) return;

    const now = Date.now();  
    rowLastUpdated.set(torrent.id, now); // Маркираме, че торентът е жив в тази секунда

    const existingRow = domRowsCache.get(torrent.id);

    if (existingRow) {  
      // Торентът съществува -> Обновяваме само променените клетки  
      currentColumns.forEach(col => {  
        const cell = existingRow.querySelector(.cell-${col.id});  
        const newValue = torrent[col.id] !== undefined ? String(torrent[col.id]) : '';  
        if (cell && cell.textContent !== newValue) {  
          cell.textContent = newValue;  
        }  
      });  
    } else {  
      // Нов торент -> Създаваме ред в таблицата  
      const tr = document.createElement('tr');  
      tr.setAttribute('data-id', torrent.id);

      currentColumns.forEach(col => {  
        const td = document.createElement('td');  
        td.className = cell-${col.id};  
        td.textContent = torrent[col.id] !== undefined ? torrent[col.id] : '';  
        tr.appendChild(td);  
      });

      tbody.appendChild(tr);  
      domRowsCache.set(torrent.id, tr);  
    }  
  });  
}

// 3. Автоматично почистване на изтрити от Transmission торенти
// Изпълнява се на всеки 3 секунди и трие редове, които не са пращали инфо наскоро
setInterval(() => {  
  const now = Date.now();  
  rowLastUpdated.forEach((lastVisible, torrentId) => {  
    // Ако торентът не е пращал данни в последните 2.5 секунди, значи е изтрит от Transmission  
    if (now - lastVisible > 2500) {  
      const rowToRemove = domRowsCache.get(torrentId);  
      if (rowToRemove) {  
        rowToRemove.remove(); // Махаме го от екрана  
        domRowsCache.delete(torrentId); // Чистим кеша  
        rowLastUpdated.delete(torrentId);  
      }  
    }  
  });  
}, 3000);

initColumnsListener();  
initRowListener();
```

## **Защо това работи перфектно за Transmission RPC?**

1. **Спестява мрежови трафик**: Transmission RPC заявките стават изключително леки, защото през мрежата (локална или отдалечена) дърпате само 4-5 полета вместо всички 30+ възможни за всеки торент.  
2. **Нулево натоварване на JS**: Фронтендът получава готов филтриран обект и просто „плюе“ стойностите в съответните клетки по техните ID ключове.  
3. **Управление на жизнения цикъл**: Системата с времеви маркировки (точка 3\) гарантира, че ако изтриете торент през друго приложение (напр. уеб интерфейса на Transmission), той автоматично ще изчезне от вашата Tauri таблица до 2-3 секунди.

Искате ли да добавим **форматиране на данните в Rust преди изпращането** (например превръщане на байтове в GB/MB и скорост в MB/s), или Transmission библиотеката, която ползвате в Rust, вече ви дава форматирани низове?