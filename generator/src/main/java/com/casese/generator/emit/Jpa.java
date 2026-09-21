package com.casese.generator.emit;

import com.squareup.javapoet.ClassName;

/**
 * Los nombres de las anotaciones que se escriben en el proyecto generado.
 *
 * <p>Están reunidos aquí, y no repartidos como cadenas por los escritores, para
 * que se vea de un vistazo de qué depende el código generado: Jakarta
 * Persistence, Spring y una sola anotación de Jackson.
 */
final class Jpa {

  private Jpa() {}

  private static final String PERSISTENCE = "jakarta.persistence";

  static final ClassName ENTITY = ClassName.get(PERSISTENCE, "Entity");
  static final ClassName TABLE = ClassName.get(PERSISTENCE, "Table");
  static final ClassName ID = ClassName.get(PERSISTENCE, "Id");
  static final ClassName GENERATED_VALUE = ClassName.get(PERSISTENCE, "GeneratedValue");
  static final ClassName GENERATION_TYPE = ClassName.get(PERSISTENCE, "GenerationType");
  static final ClassName COLUMN = ClassName.get(PERSISTENCE, "Column");
  static final ClassName JOIN_COLUMN = ClassName.get(PERSISTENCE, "JoinColumn");
  static final ClassName JOIN_TABLE = ClassName.get(PERSISTENCE, "JoinTable");
  static final ClassName MANY_TO_ONE = ClassName.get(PERSISTENCE, "ManyToOne");
  static final ClassName ONE_TO_MANY = ClassName.get(PERSISTENCE, "OneToMany");
  static final ClassName ONE_TO_ONE = ClassName.get(PERSISTENCE, "OneToOne");
  static final ClassName MANY_TO_MANY = ClassName.get(PERSISTENCE, "ManyToMany");
  static final ClassName INHERITANCE = ClassName.get(PERSISTENCE, "Inheritance");
  static final ClassName INHERITANCE_TYPE = ClassName.get(PERSISTENCE, "InheritanceType");
  static final ClassName CASCADE_TYPE = ClassName.get(PERSISTENCE, "CascadeType");

  /**
   * Corta los ciclos al convertir una entidad en JSON. Se pone en el lado
   * inverso de cada relación: el propietario, que es el que lleva la clave
   * foránea, sí se serializa, de modo que una Factura viaja con su Cliente y un
   * Cliente no arrastra consigo todas sus facturas.
   */
  static final ClassName JSON_IGNORE =
      ClassName.get("com.fasterxml.jackson.annotation", "JsonIgnore");

  static final ClassName JPA_REPOSITORY =
      ClassName.get("org.springframework.data.jpa.repository", "JpaRepository");
  static final ClassName REPOSITORY_ANNOTATION =
      ClassName.get("org.springframework.stereotype", "Repository");
  static final ClassName SERVICE_ANNOTATION =
      ClassName.get("org.springframework.stereotype", "Service");
  static final ClassName TRANSACTIONAL =
      ClassName.get("org.springframework.transaction.annotation", "Transactional");

  private static final String WEB = "org.springframework.web.bind.annotation";

  static final ClassName REST_CONTROLLER = ClassName.get(WEB, "RestController");
  static final ClassName REQUEST_MAPPING = ClassName.get(WEB, "RequestMapping");
  static final ClassName GET_MAPPING = ClassName.get(WEB, "GetMapping");
  static final ClassName POST_MAPPING = ClassName.get(WEB, "PostMapping");
  static final ClassName PUT_MAPPING = ClassName.get(WEB, "PutMapping");
  static final ClassName DELETE_MAPPING = ClassName.get(WEB, "DeleteMapping");
  static final ClassName PATH_VARIABLE = ClassName.get(WEB, "PathVariable");
  static final ClassName REQUEST_BODY = ClassName.get(WEB, "RequestBody");

  static final ClassName RESPONSE_ENTITY =
      ClassName.get("org.springframework.http", "ResponseEntity");
  static final ClassName HTTP_STATUS = ClassName.get("org.springframework.http", "HttpStatus");

  static final ClassName SPRING_BOOT_APPLICATION =
      ClassName.get("org.springframework.boot.autoconfigure", "SpringBootApplication");
  static final ClassName SPRING_APPLICATION =
      ClassName.get("org.springframework.boot", "SpringApplication");
}
