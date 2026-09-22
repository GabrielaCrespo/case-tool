# generator — CU07

Convierte el modelo UML de CASE-Tool en un proyecto Spring Boot completo. Es un
programa Java 21 con Spring Boot y Maven que escribe el código con **JavaPoet**;
el backend NestJS lo invoca como un jar ejecutable.

## Compilarlo

Hay que hacerlo una vez antes de poder generar nada desde la aplicación:

```bash
mvn -f generator/pom.xml package
```

Deja `generator/target/generator.jar`, que es donde el backend lo busca. Si se
prefiere tenerlo en otro sitio, se indica con la variable de entorno
`GENERATOR_JAR` del backend.

## Ejecutarlo a mano

```bash
java -jar target/generator.jar modelo.json directorio-de-salida [informe.json]
```

- `modelo.json` es el diagrama **tal como lo devuelve `GET /diagrams/:id`**, sin
  ninguna conversión, envuelto en `{ "base_package": …, "artifact_id": …,
  "diagram": … }`. No hay un formato intermedio que mantener: los campos que el
  generador no usa —posiciones, tamaños, fechas— simplemente se ignoran.
- En el directorio de salida queda el proyecto Spring Boot.
- En `informe.json`, si se pide, queda el resumen de lo generado y los avisos.

Termina con código 0 si escribió el proyecto y con 1 si no pudo, que es lo que
el backend mira para dar el trabajo por bueno o por fallido.

## Cómo se lee un diagrama

### Qué genera cada clase

| Estereotipo | Qué sale |
|---|---|
| `entity` o **sin estereotipo** | `@Entity` + repositorio + servicio + controlador REST |
| `interface` | Una interfaz Java con las firmas declaradas |
| `enumeration` | Un `enum` cuyos valores son los nombres de sus atributos |
| `service` | Una clase `@Service` con las operaciones declaradas |

Una clase del lienzo nace sin estereotipo, y en un diagrama de clases lo que se
dibuja son las cosas que hay que guardar: por eso «sin estereotipo» se trata
como entidad en lugar de descartarse. Una clase abstracta sí tiene tabla, pero
no repositorio ni endpoints: no se puede instanciar.

### Claves primarias

Toda entidad lleva la misma: un `Long id` con
`@GeneratedValue(strategy = IDENTITY)`, que en PostgreSQL es una columna
`BIGSERIAL`. No se lee del diagrama y no hay nada que elegir.

Es así porque la clave primaria no se dibuja: la herramienta no deja declararla
como atributo, para que no lleguen aquí los casos que impedían generar —dos
atributos marcados como clave, una clave sin tipo, o de un tipo que la base no
sabe autogenerar—. Un atributo llamado `id` que venga de un diagrama guardado
antes de esa regla se omite, y se dice en `informe.json`.

Una subclase no declara `@Id`: lo hereda, como en Java.

### Relaciones

Las multiplicidades se leen con el significado habitual de UML: cada etiqueta
dice cuántos objetos de ese extremo corresponden a uno del otro. En
`Cliente 1 ── 0..* Factura` un Cliente tiene muchas Facturas y cada Factura
tiene un Cliente.

| En el diagrama | En el backend generado |
|---|---|
| 1 ── 0..* | `@ManyToOne` + `@JoinColumn` en el lado «muchos», `@OneToMany(mappedBy)` en el otro |
| 0..* ── 0..* | `@ManyToMany` + `@JoinTable` con sus dos columnas |
| 1 ── 1 | `@OneToOne` + `@JoinColumn` en el origen, `@OneToOne(mappedBy)` en el destino |
| Herencia | `extends`, con `@Inheritance(strategy = JOINED)` en la superclase |
| Realización | `implements` |
| Composición | La colección lleva `cascade = ALL` y `orphanRemoval` |
| Dependencia | Nada: dice que una clase usa a otra, no que guarde una referencia |

El muchos-a-muchos se genera igual aunque el editor recomiende resolverlo con
una clase de asociación, porque el modelo permite guardarlo así y un diagrama
con esa relación llega al generador como válido.

El lado propietario —el que lleva la clave foránea o la tabla intermedia— se
genera siempre, aunque el diagrama diga que por ahí no se navega: sin él la
relación desaparecería de las tablas. El lado inverso sí respeta la
navegabilidad, y lleva `@JsonIgnore` para que convertir una entidad en JSON no
entre en un ciclo.

Los roles escritos en los extremos dan nombre a los campos; si no los hay, se
usa el nombre de la otra clase. Dos relaciones entre las mismas dos clases se
distinguen con un número.

### Operaciones

Los métodos declarados en el diagrama se escriben con su firma exacta y un
cuerpo que lanza `UnsupportedOperationException`: así el proyecto compila y
arranca, y queda señalado lo único que el generador no puede adivinar. Un
método que chocara con un descriptor de acceso generado se omite.

## Estructura del código

```
model/     El diagrama leído del JSON, con los mismos nombres que la API.
java/      Nombres (Java y SQL) y la traducción de tipos UML a tipos Java.
plan/      Qué es cada clase y qué campo gana por cada relación. Aquí se
           contestan las preguntas difíciles, antes de escribir nada.
emit/      La traducción de ese plan a código, con JavaPoet.
```

`java/JavaTypes` es el reflejo de `DATA_TYPES` en
`backend/src/diagrams/uml-catalog.ts`: los dos listados tienen que decir lo
mismo, porque un tipo que allí se admita y aquí no exista sería un atributo que
el usuario puede guardar y el generador no sabe escribir.
