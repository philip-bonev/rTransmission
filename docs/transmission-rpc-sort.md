"Може да се направи изключително лесно и бързо с **чист JavaScript**. Тъй като вече имате направен DOM кеш в паметта (domRowsCache), сортирането става с няколко реда код, без да натоварва процесора.

Основният принцип е следният: когато потребителят щракне върху заглавието на някоя колона (\<th\>), вие взимате всички редове от таблицата, сортирате ги в JavaScript масив по стойността в съответната клетка и ги прикачвате обратно в \<tbody\>.

Ето как да добавите тази функционалност към текущия си код:

## **1. Добавяне на CSS стилове за визуален ориентир (по избор)**

Добре е потребителят да вижда коя колона е сортирана в момента.

```javascript
th { cursor: pointer; user-select: none; }
th.sort-asc::after { content: " ↑"; }
th.sort-desc::after { content: " ↓"; }
```

## **2. Добавяне на логиката за сортиране в JavaScript**

Ще въведем две променливи, които да помнят коя е **актуалната колона за сортиране** и в каква **посока** (възходяща или низходяща) е тя. Тъй като данните се обновяват всяка секунда от Rust, ние ще прилагаме това сортиране **както при клик, така и автоматично при всяко ново събитие**, за да не се разваля редът на торентите.

```rust
// Пазим състоянието на сортирането  
let currentSortColumn = 'id'; // По подразбиране сортираме по ID  
let isAscending = true;       // По подразбиране е възходящо (ascending)

// 1. Модифицираме renderHeaders(), за да хващаме кликванията  
fn renderHeaders() {  
  theadRow.innerHTML = '';  
    
  currentColumns.forEach(col => {  
    const th = document.createElement('th');  
    th.textContent = col.description;  
    th.setAttribute('data-col-id', col.id);  
      
    // Добавяме визуален маркер, ако това е сортираната колона  
    if (col.id === currentSortColumn) {  
      th.className = isAscending ? 'sort-asc' : 'sort-desc';  
    }

    // СЪБИТИЕ ПРИ КЛИК: Потребителят сортира ръчно  
    th.addEventListener('click', () => {  
      if (currentSortColumn === col.id) {  
        // Ако кликне пак на същата колона, обръщаме посоката  
        isAscending = !isAscending;  
      } else {  
        // Ако кликне на нова колона, сортираме по нея във възходящ ред  
        currentSortColumn = col.id;  
        isAscending = true;  
      }  
        
      // Преначертаваме заглавията (за да се преместят стрелките ↑/↓)  
      renderHeaders();  
      // Сортираме таблицата веднага  
      sortTableHTML();  
    });

    theadRow.appendChild(th);  
  });  
}

// 2. Функция, която извършва физическото сортиране в HTML  
function sortTableHTML() {  
  const rowsArray = Array.from(tbody.querySelectorAll('tr'));  
    
  rowsArray.sort((a, b) => {  
    // Взимаме текстовото съдържание на клетките, които сравняваме  
    const cellA = a.querySelector(.cell-${currentSortColumn})?.textContent || '';  
    const cellB = b.querySelector(.cell-${currentSortColumn})?.textContent || '';

    // Проверка дали стойностите са числа (напр. ID, Прогрес, Скорост), за да сортира правилно  
    // (Ако сортираме числа като текст, "10" ще отиде преди "2")  
    const numA = parseFloat(cellA);  
    const numB = parseFloat(cellB);

    if (!isNaN(numA) && !isNaN(numB)) {  
      // Сортиране на числа  
      return isAscending ? numA - numB : numB - numA;  
    } else {  
      // Сортиране на текст (алфабетно, с поддръжка на кирилица)  
      return isAscending   
        ? cellA.localeCompare(cellB)   
        : cellB.localeCompare(cellA);  
    }  
  });

  // Пренареждаме редовете в DOM дървото  
  // appendChild на съществуващ елемент автоматично го премества най-отдолу, без да го дублира  
  rowsArray.forEach(row => tbody.appendChild(row));  
}

## 3. Обвързване с таймера (Rust Events)

За да остане таблицата сортирана, когато в следващата секунда Transmission върне нови скорости на сваляне или нов прогрес, просто извикайте функцията sortTableHTML() най-отдолу вътре в слушателя на събития (initRowListener), веднага след блока else:

```javascript
async function initRowListener() {  
  await listen('row-update', (event) => {  
    const torrent = event.payload;  
    if (!torrent.id) return;

    const existingRow = domRowsCache.get(torrent.id);  
    if (existingRow) {  
      // ... (обновяване на клетките) ...  
    } else {  
      // ... (създаване на нов ред) ...  
    }

    // ИЗВИКВА СЕ ТУК: Сортираме след всяко пристигнало обновление от Rust  
    sortTableHTML();   
  });  
}
```

## **Защо това решение на чист JS е перфектно?**

1. **Сортиране на числа срещу текст**: Кодът автоматично разпознава дали в клетката има число (прогрес 85.4 или скорост 12.5) или текст (име на торент "Ubuntu...") и прилага правилния математически или азбучен алгоритъм.  
2. **Няма премигване**: Тъй като appendChild работи директно с референциите на елементите в паметта, разместването на редовете става мигновено (за под 1 милисекунда) и потребителят вижда напълно гладко движение.

Имате ли нужда от помощ с това как Transmission подава стойностите (например, ако скоростта идва като чисто число в байтове 12582912 от Rust, а вие искате потребителят да може да сортира по него, но визуално да вижда "12 MB/s")?