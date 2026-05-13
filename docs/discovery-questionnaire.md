# Cuestionario de Discovery — Fase 0

**Para:** cliente (dueño del negocio) y esposa
**De:** Nicolás (dev)
**Objetivo:** entender el catálogo y la operación real antes de construir.
**Tiempo estimado:** 45–60 minutos de conversación + envío de 3–5 archivos por email.
**Fecha:** ********\_********

> Este cuestionario tiene una razón concreta: sin saber estas respuestas, **todo lo que construyamos arriba va a ser ruido**. No es burocracia, es lo que evita reescribir el sistema en 2 meses. Si una respuesta es "no sé" o "no lo tenemos", también es información — solo dilo.

---

## Bloque A — Catálogo (lo más crítico)

### A.1 Identificadores comunes

**¿Sus productos tienen alguno de estos códigos que se mantenga igual entre canales?**

- [ ] **Código de barras / EAN** (los 13 dígitos del paquete)
- [ ] **Código interno del proveedor** (el que viene del proveedor importador, distribuidor)
- [ ] **SKU propio** (un código que ustedes inventaron y se aplica igual en WP/ML/Dropi/POS)
- [x] **Nombre exacto** (palabra por palabra, sin variaciones)
- [x] **Ninguno** — cada canal nombra/codifica el producto distinto

**Si marcaste alguno, ¿qué porcentaje aproximado del catálogo lo tiene?**

- Catálogo total estimado: 200 SKUs
- Con código de barras: 80 %
- Con código de proveedor: 100 %
- Con SKU propio común: 70 %

> **Por qué importa:** si tienen barcodes o código de proveedor, el matching automático sube del ~60% al ~95%. Sin ningún identificador común, dependemos 100% de IA para conectar "Plancha de Cabello X" en WordPress con "PLANCHA-CAB-2026" en ML.

### A.2 Variantes

**¿Manejan productos con variantes (talla, color, capacidad, voltaje)?**

- [x] Sí — ¿qué % del catálogo tiene variantes? 20 %
- [ ] No / muy pocos

**Si sí: ¿cada variante tiene su propio identificador o todas las variantes comparten el mismo SKU?**

- [ ] Cada variante = un SKU distinto
- [ ] Variantes comparten SKU, diferencian por atributo en el nombre o un campo aparte
- [x] Mixto / depende del canal

### A.3 Estado del producto

**¿Cómo distinguen un producto "activo" de uno "descontinuado"?**

- [x] Por presencia/ausencia en cada plataforma
- [ ] Por un campo "estado" en algún sistema
- [ ] No lo distinguen formalmente
- [ ] Otro: ****\_\_\_\_****

**¿Qué porcentaje del catálogo activo total estiman que NO se ha vendido en los últimos 90 días?** 25 %

### A.4 Categorías y marcas

**¿Tienen una taxonomía de categorías consistente entre canales?**

- [ ] Sí, las mismas en todas partes
- [x] No, cada canal tiene su propio árbol
- [ ] No usamos categorías sistemáticamente

**¿Cuántas categorías raíz manejan aproximadamente?** 8

**¿Marcas/proveedores principales (top 5)?**

1. ***
2. ***
3. ***
4. ***
5. ***

---

## Bloque B — Volumen real por canal

> **Las cifras del PRD asumen 5.000 transacciones/mes consolidadas. Confirmemos.**

Para cada canal, las **ventas del último mes completo** (lo más actual que tengan):

| Canal                  | # órdenes/mes | Ingreso $/mes | Ticket promedio | % del total |
| ---------------------- | ------------- | ------------- | --------------- | ----------- |
| WordPress              |               |               |                 |             |
| Mercado Libre Colombia |               |               |                 |             |
| Dropi (como proveedor) |               |               |                 |             |
| POS físico #1          |               |               |                 |             |
| POS físico #2          |               |               |                 |             |
| WhatsApp               |               |               |                 |             |
| **Total**              |               |               |                 | 100%        |

**¿Qué tan estacionales son? (cualquier mes muy distinto al promedio en últimos 12 meses)**

---

---

## Bloque C — Histórico a backfillear

**¿Cuánto histórico de ventas quieren ver en el dashboard desde el día uno?**

- [ ] Solo desde que arranque (sin histórico)
- [x] Últimos 3 meses
- [x] Últimos 6 meses
- [x] Último año
- [ ] Más de un año (especificar): ****\_\_\_\_****

> **Por qué importa:** cargar 3 años de histórico de 5 canales puede ser pesado. Si solo quieren ver tendencias del año en curso, ahorramos trabajo.

**¿Tienen exports CSV/Excel del histórico ya guardados, o tendríamos que extraerlos canal por canal?**

---

---

## Bloque D — Cada canal en detalle

### D.1 WordPress

- **¿Es WooCommerce o algo custom?** ****\_\_\_\_****
- **URL del sitio:** [https://catalogofakastore.com/]
- **¿Tienen acceso de administrador para crear API keys?** [X] Sí [ ] No
- **¿Cuántos productos publicados aproximadamente?** no se
- **¿Usan plugin de variantes?** NO
- **¿Tienen webhooks ya configurados para algo?** [ ] Sí — para qué: ****\_\_\_**** [ ] No

### D.2 Mercado Libre Colombia

- **Nombre del seller/tienda:** www.mercadolibre.com.co/tienda/letal-shark
- **¿Tienen ya una app registrada en MercadoLibre Developers?** [ ] Sí [X] No
- **Si sí, ¿pueden compartirme client_id y client_secret?** [ ] Sí [ ] No / requiere coordinación
- **¿Cuántas publicaciones activas?** No se
- **¿Usan Mercado Envíos o envíos propios?** los dos

### D.3 Dropi (como proveedor)

- **Email/usuario del panel:** no esta claro, buscandolo
- **¿Quién accede normalmente al panel?** el cliente
- **¿Cuántos productos ofrecen como proveedor en Dropi?** no sabe
- **¿Han notado que Dropi cambie la interfaz seguido?** [ ] Sí [X] No [X] No lo sé
- **¿Pueden exportar las órdenes desde el panel como CSV manualmente?** [X] Sí [ ] No [ ] No lo sé

### D.4 POS físico

- **¿Marca y modelo del software de POS?** No
- **¿Es un POS comercial (algo conocido) o uno desarrollado a la medida?** a la medida
- **Nombre y contacto del programador que lo mantiene:** Si
- **¿El POS puede emitir webhooks (notificaciones HTTP) cuando se cierra una venta?**
  - [ ] Sí, ya lo hace
  - [x] Probablemente se puede agregar
  - [x] No, hay que pollearlo o exportar CSV
  - [ ] No lo sé — necesito preguntar al programador
- **¿Los dos puntos comparten el mismo POS o son independientes?** ****\_\_\_\_****
- **¿Cómo identifican el punto de venta en cada transacción?** ****\_\_\_\_****

### D.5 WhatsApp

- **¿Quién vende por WhatsApp? (uno solo, varios?)** uno solo
- **¿Volumen promedio diario de pedidos por WhatsApp?** 5 a 10
- **¿Tienen alguna plantilla o método actual para registrar la venta?** No
- **Confirmar: ¿están de acuerdo con que el registro sea un formulario interno en el dashboard (no integración WhatsApp Business API)?** [ ] Sí [X] No, prefiero Integrar\_

---

## Bloque E — Cliente final / repetición

**¿Capturan el número de teléfono o cédula del cliente final cuando vende?**

- [ ] Siempre
- [ ] En algunos canales
- [x] Casi nunca

**¿En qué canales sí capturan identificador del cliente?**

- [x] WordPress (registro/checkout)
- [ ] Mercado Libre
- [ ] Dropi
- [x] POS
- [x] WhatsApp

> **Por qué importa:** sin identificador de cliente no podemos detectar canibalización entre canales ni medir recompra. Es OK si no, lo manejamos.

---

## Bloque F — Costos y márgenes

**¿Tienen documentado el costo unitario por producto?**

- [ ] Sí, en alguna planilla o ERP
- [ ] Sí, pero variable (cambia con cada compra al proveedor)
- [x] Más o menos, en la cabeza
- [x] No

**¿Pueden compartir esa información (aunque sea aproximada por categoría)?**

- [ ] Sí
- [ ] No por ahora
- [x] Lo construimos juntos

**¿Manejan promociones o descuentos? ¿Cómo los aplican?**
Si, pero no tengo trazabilidad de esto, descuento directo, cambio el precio o codigo de descuento, depende.

---

## Bloque G — Política de devoluciones

**¿Qué porcentaje aproximado de ventas se devuelve?** 5% %

**¿En qué canales hay más devoluciones?** Dropi y ML

**¿Cómo registran una devolución hoy?** lo que digan las plataformas

---

## Bloque H — Capa de IA — qué quieren ver

**Modo autónomo (insights AM/PM):**

¿Cuál de estos formatos prefieren para los insights diarios?

- [ ] Solo cards en el dashboard
- [ ] Dashboard + resumen por email
- [x] Dashboard + mensaje de WhatsApp al teléfono del dueño
- [ ] Las tres anteriores

**¿A qué horas exactamente?**

- AM: Si (default propuesto: 8:00 AM Colombia)
- PM: podemos bajarlo a 5:30 PM (default propuesto: 6:00 PM Colombia)

**Modo conversacional (chat):**

¿Qué tipo de preguntas anticipan hacerle al chat? (3 ejemplos)

1. ***
2. ***
3. ***

**Modelo de IA inicial:**

El PRD propone arrancar con uno de estos. Recomendación del dev: **Claude Haiku 4.5** por mejor relación precio/calidad para análisis estructurado en español.

- [x] Aceptamos la recomendación (Claude Haiku 4.5)
- [x] Prefieren empezar con Kimi K2 desde el día uno
- [x] Prefieren GPT-4o-mini
- [x] Nos da igual, el dev decide y compara después

---

## Bloque I — Roles, permisos, accesos

**Confirmar los 3 usuarios definidos:**

- [x] Nicolás (dev) — ve todo + logs técnicos
- [x] Cliente (dueño) — ve todo, sin logs técnicos
- [x] Esposa — ve todo, sin logs técnicos

**¿En el futuro vendrían usuarios "staff" (vendedores)? ¿Cuántos potencialmente?** Poco tal vez 1 analista

---

## Bloque J — Operación (qué duele hoy)

**Cuéntame en orden de prioridad: ¿qué 3 cosas te frustran hoy al no tener la visión consolidada?**

1. no tener visualizacion de los datos y lo que sucede
2. que no tenga todo centralizado
3. tomar mejores desiciones para comprar mercancia

**¿Qué decisión tomarías diferente si tuvieras esta data esta misma semana?**

podria pensar en promociones con la mercancia que no se esta vendiendo, estrategias comerciales, ver si esa categoria o tipo de producto se vende o salir rapido de ella, saber que comprar en mis proximas compras

---

## Bloque K — Quirks conocidos

**¿Hay algún producto que sepan que se vende muy distinto entre canales?** (ejemplo: "la plancha XYZ es bestseller en ML pero invisible en WP")

no

**¿Algún producto que se llame diferente en cada canal y lo recuerdes?**

varios

---

## Checklist de entregas adjuntas

Después de esta conversación, el cliente debe enviar por email o subir a una carpeta compartida:

- [ ] **CSV/Excel del catálogo de WordPress** (todos los productos publicados)
- [ ] **CSV/Excel del catálogo de Mercado Libre** (todas las publicaciones)
- [ ] **CSV/Excel del catálogo de Dropi** (productos que ofrecen como proveedor)
- [ ] **CSV/Excel del catálogo del POS** (productos del inventario maestro)
- [ ] **Listado de SKUs vendidos por WhatsApp en últimos 30 días** (puede ser un Word, no necesita ser CSV)
- [ ] **Histórico de ventas del último mes** por cada canal (si está disponible)
- [ ] **Credenciales** (vía canal seguro, no email):
  - [ ] WordPress: admin login o API key
  - [ ] Mercado Libre Developers: client_id + client_secret
  - [ ] Dropi: usuario + contraseña del panel

**Ver `docs/csv-templates/` para el formato sugerido de cada CSV.**

---

## Cierre

Tres acuerdos importantes después de responder esto:

1. **Hasta que estas respuestas estén, no se construye Fase 1.** No es burocracia: si arrancamos sin saber si tienen barcodes, vamos a tener que rehacer la pieza más importante del sistema (matching) en 3 semanas.

2. **El dashboard NO va a poder mostrar "Plancha X vendió 50 unidades" hasta que el matching esté validado.** En el primer mes verás "este producto en WP" y "este producto en ML" como entidades separadas mientras la cola de validación se llena. Es parte del proceso.

3. **El presupuesto de $150/mes incluye IA.** Si el chat se usa mucho o piden insights cada hora, podemos pasarnos. Hay un tope diario de tokens configurable que se ajusta.

---

_Documento de discovery. Última actualización: 2026-05-13._
