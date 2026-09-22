package com.casese.generator.plan;

import com.casese.generator.java.JavaTypes;
import com.casese.generator.java.Names;
import com.casese.generator.model.GenerationRequest;
import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlClass;
import com.casese.generator.model.UmlModel;
import com.casese.generator.model.UmlRelationship;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.TypeName;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * La lectura del diagrama: decide qué es cada clase y qué campo gana cada una
 * por estar relacionada con otra, antes de que se escriba una sola línea de
 * Java.
 *
 * <p>Está separado de los escritores a propósito. Aquí se contestan las
 * preguntas difíciles —quién lleva la clave foránea, qué pasa con una herencia,
 * cómo se llama un campo cuando dos relaciones unen las mismas clases— y allí
 * sólo se traduce la respuesta a anotaciones.
 */
public final class Blueprint {

  private final GenerationRequest request;
  private final UmlModel model;

  private final Map<String, UmlClass> byId = new LinkedHashMap<>();
  private final Map<String, UmlClass> byName = new LinkedHashMap<>();

  private final List<EntityPlan> entities = new ArrayList<>();
  private final List<UmlClass> interfaces = new ArrayList<>();
  private final List<UmlClass> enumerations = new ArrayList<>();
  private final List<UmlClass> services = new ArrayList<>();

  /** Decisiones que el usuario debe conocer; acaban en el README generado. */
  private final List<String> notes = new ArrayList<>();

  public Blueprint(GenerationRequest request) {
    this.request = request;
    this.model = request.diagram();

    for (UmlClass umlClass : model.classes()) {
      byId.put(umlClass.id(), umlClass);
      byName.put(umlClass.name(), umlClass);
    }
    classify();
    plan();
  }

  // ------------------------------------------------------------ clasificación

  private void classify() {
    for (UmlClass umlClass : model.classes()) {
      if (umlClass.hasStereotype("interface")) {
        interfaces.add(umlClass);
      } else if (umlClass.hasStereotype("enumeration")) {
        enumerations.add(umlClass);
      } else if (umlClass.hasStereotype("service")) {
        services.add(umlClass);
      }
    }
  }

  private boolean isPersistent(UmlClass umlClass) {
    return umlClass != null && umlClass.isPersistent();
  }

  // ------------------------------------------------------------ planificación

  private void plan() {
    Map<String, UmlClass> parents = new LinkedHashMap<>();
    Map<String, List<UmlClass>> realized = new LinkedHashMap<>();
    Set<String> withChildren = new HashSet<>();

    readHierarchy(parents, realized, withChildren);

    // Cada clase persistente con sus columnas. Los enlaces se añaden después,
    // cuando ya se sabe qué nombres están ocupados.
    Map<String, List<UmlAttribute>> columns = new LinkedHashMap<>();
    Map<String, Set<String>> taken = new LinkedHashMap<>();
    Map<String, List<Link>> links = new LinkedHashMap<>();

    for (UmlClass umlClass : model.classes()) {
      if (!isPersistent(umlClass)) {
        continue;
      }
      List<UmlAttribute> own = columnsOf(umlClass);
      columns.put(umlClass.id(), own);

      // La clave primaria y el contador de versión ocupan su nombre en todas:
      // una subclase los hereda del padre, pero los campos existen igual y una
      // relación no puede llamarse como ellos.
      Set<String> used = new LinkedHashSet<>();
      used.add(EntityPlan.ID_NAME);
      used.add(EntityPlan.VERSION_NAME);
      own.forEach(attribute -> used.add(attribute.name()));
      taken.put(umlClass.id(), used);
      links.put(umlClass.id(), new ArrayList<>());
    }

    readAssociations(taken, links);

    for (UmlClass umlClass : model.classes()) {
      if (!isPersistent(umlClass)) {
        continue;
      }
      entities.add(
          new EntityPlan(
              umlClass,
              parents.get(umlClass.id()),
              realized.getOrDefault(umlClass.id(), List.of()),
              withChildren.contains(umlClass.id()),
              // Sólo la raíz de la jerarquía declara el @Id; las demás lo
              // heredan, y declararlo otra vez no compilaría.
              !parents.containsKey(umlClass.id()),
              columns.get(umlClass.id()),
              links.get(umlClass.id())));
    }
  }

  /**
   * Herencias y realizaciones. Java tiene una sola superclase: si el diagrama
   * dibuja más de una, se conserva la primera y se avisa, porque callarlo daría
   * un proyecto al que le falta media jerarquía sin decir por qué.
   */
  private void readHierarchy(
      Map<String, UmlClass> parents, Map<String, List<UmlClass>> realized, Set<String> withChildren) {

    for (UmlRelationship relationship : model.relationships()) {
      if (!relationship.isStructural()) {
        continue;
      }
      UmlClass child = byId.get(relationship.sourceClassId());
      UmlClass parent = byId.get(relationship.targetClassId());

      if (child == null || parent == null || child == parent) {
        continue;
      }

      // Heredar de una clase marcada «interface» es implementarla, lo dibuje el
      // usuario con la flecha de herencia o con la de realización.
      if (parent.hasStereotype("interface")) {
        realized.computeIfAbsent(child.id(), key -> new ArrayList<>()).add(parent);
        continue;
      }

      if (!isPersistent(child) || !isPersistent(parent)) {
        continue;
      }
      if (parents.containsKey(child.id())) {
        notes.add(
            "%s hereda de varias clases; Java sólo admite una, así que se conserva %s."
                .formatted(child.name(), parents.get(child.id()).name()));
        continue;
      }
      parents.put(child.id(), parent);
      withChildren.add(parent.id());
    }
  }

  /** Los atributos que serán columnas: ni la clave primaria ni los que no tienen tipo. */
  private List<UmlAttribute> columnsOf(UmlClass umlClass) {
    List<UmlAttribute> result = new ArrayList<>();

    for (UmlAttribute attribute : umlClass.attributes()) {
      /*
       * Un atributo llamado «id» se omite: la clave primaria de la tabla la
       * pone el generador, y declarar además un campo con ese nombre daría dos
       * columnas iguales. El editor ya no deja crearlo y las importaciones lo
       * descartan, así que aquí sólo puede llegar desde un diagrama guardado
       * antes de esa regla.
       */
      if (attribute.name().equalsIgnoreCase(EntityPlan.ID_NAME)) {
        notes.add(
            "El atributo %s.%s se ha omitido: la clave primaria «%s» la pone el generador."
                .formatted(umlClass.name(), attribute.name(), EntityPlan.ID_NAME));
        continue;
      }
      /*
       * Lo mismo con «version»: el campo que lleva la cuenta de las
       * modificaciones lo pone el generador en todas las entidades, y una
       * columna del diagrama con ese nombre daría dos campos iguales.
       */
      if (attribute.name().equalsIgnoreCase(EntityPlan.VERSION_NAME)) {
        notes.add(
            "El atributo %s.%s se ha omitido: «%s» lo lleva el generador para detectar"
                    + " escrituras en conflicto."
                .formatted(umlClass.name(), attribute.name(), EntityPlan.VERSION_NAME));
        continue;
      }
      if (!attribute.hasType()) {
        notes.add(
            "El atributo %s.%s no tiene tipo y se ha omitido."
                .formatted(umlClass.name(), attribute.name()));
        continue;
      }
      if (!JavaTypes.isCatalogType(attribute.dataType())) {
        notes.add(
            "El atributo %s.%s usa el tipo «%s», que no está en el catálogo, y se ha omitido."
                .formatted(umlClass.name(), attribute.name(), attribute.dataType()));
        continue;
      }
      result.add(attribute);
    }
    return result;
  }

  /**
   * Convierte cada asociación del diagrama en los campos JPA que le
   * corresponden, siguiendo las multiplicidades.
   *
   * <p>El lado propietario se genera siempre, incluso si el diagrama dice que
   * por ahí no se navega: es quien lleva la clave foránea, y sin él la relación
   * no existiría en la base de datos. El lado inverso, que sólo sirve para
   * poder ir de vuelta, sí respeta la navegabilidad.
   */
  private void readAssociations(Map<String, Set<String>> taken, Map<String, List<Link>> links) {
    for (UmlRelationship relationship : model.relationships()) {
      if (!relationship.isAssociation()) {
        continue;
      }
      UmlClass source = byId.get(relationship.sourceClassId());
      UmlClass target = byId.get(relationship.targetClassId());

      if (source == null || target == null) {
        continue;
      }
      if (!isPersistent(source) || !isPersistent(target)) {
        notes.add(
            "La relación %s–%s une clases que no son entidades y no genera ningún campo."
                .formatted(source.name(), target.name()));
        continue;
      }

      boolean sourceMany = relationship.sourceIsMany();
      boolean targetMany = relationship.targetIsMany();

      if (sourceMany && targetMany) {
        manyToMany(relationship, source, target, taken, links);
      } else if (targetMany) {
        // Un origen tiene muchos destinos: la clave foránea va en el destino.
        oneToMany(relationship, source, target, taken, links);
      } else if (sourceMany) {
        oneToMany(relationship, target, source, taken, links);
      } else {
        oneToOne(relationship, source, target, taken, links);
      }
    }
  }

  /** {@code one} tiene muchos {@code many}; cada {@code many} tiene un {@code one}. */
  private void oneToMany(
      UmlRelationship relationship,
      UmlClass one,
      UmlClass many,
      Map<String, Set<String>> taken,
      Map<String, List<Link>> links) {

    boolean fromSource = one.id().equals(relationship.sourceClassId());
    String roleOnMany = fromSource ? relationship.sourceRole() : relationship.targetRole();
    String roleOnOne = fromSource ? relationship.targetRole() : relationship.sourceRole();
    boolean navigableToMany =
        fromSource ? relationship.isNavigableTarget() : relationship.isNavigableSource();

    String owner = free(many, taken, roleOnMany, Names.camel(one.name()));
    links
        .get(many.id())
        .add(
            new Link(
                Link.Kind.MANY_TO_ONE,
                owner,
                one,
                null,
                foreignKey(one),
                null,
                null,
                null,
                false,
                relationship));

    if (navigableToMany) {
      String inverse = free(one, taken, roleOnOne, Names.collectionField(many.name()));
      links
          .get(one.id())
          .add(
              new Link(
                  Link.Kind.ONE_TO_MANY,
                  inverse,
                  many,
                  owner,
                  null,
                  null,
                  null,
                  null,
                  relationship.isComposition(),
                  relationship));
    }
  }

  private void manyToMany(
      UmlRelationship relationship,
      UmlClass source,
      UmlClass target,
      Map<String, Set<String>> taken,
      Map<String, List<Link>> links) {

    String owner =
        free(source, taken, relationship.targetRole(), Names.collectionField(target.name()));
    boolean reflexive = source.id().equals(target.id());

    links
        .get(source.id())
        .add(
            new Link(
                Link.Kind.MANY_TO_MANY_OWNER,
                owner,
                target,
                null,
                null,
                Names.snake(source.name()) + "_" + Names.snake(target.name()),
                foreignKey(source),
                // Una clase unida consigo misma daría dos columnas iguales.
                reflexive ? Names.snake(target.name()) + "_relacionado_id" : foreignKey(target),
                false,
                relationship));

    if (relationship.isNavigableSource()) {
      String inverse =
          free(target, taken, relationship.sourceRole(), Names.collectionField(source.name()));
      links
          .get(target.id())
          .add(
              new Link(
                  Link.Kind.MANY_TO_MANY_INVERSE,
                  inverse,
                  source,
                  owner,
                  null,
                  null,
                  null,
                  null,
                  false,
                  relationship));
    }
  }

  private void oneToOne(
      UmlRelationship relationship,
      UmlClass source,
      UmlClass target,
      Map<String, Set<String>> taken,
      Map<String, List<Link>> links) {

    String owner = free(source, taken, relationship.targetRole(), Names.camel(target.name()));
    links
        .get(source.id())
        .add(
            new Link(
                Link.Kind.ONE_TO_ONE_OWNER,
                owner,
                target,
                null,
                foreignKey(target),
                null,
                null,
                null,
                relationship.isComposition(),
                relationship));

    if (relationship.isNavigableSource()) {
      String inverse = free(target, taken, relationship.sourceRole(), Names.camel(source.name()));
      links
          .get(target.id())
          .add(
              new Link(
                  Link.Kind.ONE_TO_ONE_INVERSE,
                  inverse,
                  source,
                  owner,
                  null,
                  null,
                  null,
                  null,
                  false,
                  relationship));
    }
  }

  private static String foreignKey(UmlClass umlClass) {
    return Names.snake(umlClass.name()) + "_id";
  }

  /**
   * Un nombre de campo libre dentro de la clase. Se prefiere el rol que escribió
   * el usuario en el extremo de la relación; si no lo hay, o no sirve como
   * identificador, se usa el nombre de la otra clase. Dos relaciones entre las
   * mismas clases se distinguen con un número, que es mejor que no compilar.
   */
  private String free(
      UmlClass umlClass, Map<String, Set<String>> taken, String role, String fallback) {

    String preferred = identifierFrom(role);
    String candidate = preferred == null ? fallback : preferred;

    Set<String> used = taken.get(umlClass.id());
    if (used == null) {
      return candidate;
    }

    String result = candidate;
    int index = 2;
    while (!used.add(result)) {
      result = candidate + index;
      index++;
    }
    return result;
  }

  /**
   * Un identificador Java a partir del rol escrito en el diagrama. Los roles son
   * texto libre —«atendido por», «línea de pedido»—, así que se quedan sus
   * letras y dígitos y se juntan en camelCase; si no queda nada utilizable se
   * devuelve {@code null} y manda el nombre de la clase.
   */
  private static String identifierFrom(String role) {
    if (role == null || role.isBlank()) {
      return null;
    }
    StringBuilder out = new StringBuilder(role.length());
    boolean upper = false;

    for (char character : role.toCharArray()) {
      if (Character.isLetterOrDigit(character)) {
        out.append(upper ? Character.toUpperCase(character) : character);
        upper = false;
      } else {
        upper = out.length() > 0;
      }
    }

    if (out.length() == 0 || !Character.isJavaIdentifierStart(out.charAt(0))) {
      return null;
    }
    return Names.camel(out.toString());
  }

  // ------------------------------------------------------------------ consulta

  public UmlModel model() {
    return model;
  }

  public List<EntityPlan> entities() {
    return List.copyOf(entities);
  }

  public List<UmlClass> interfaces() {
    return List.copyOf(interfaces);
  }

  public List<UmlClass> enumerations() {
    return List.copyOf(enumerations);
  }

  public List<UmlClass> services() {
    return List.copyOf(services);
  }

  public List<String> notes() {
    return List.copyOf(notes);
  }

  /** El nombre de una clase por su identificador, para redactar comentarios. */
  public String nameOf(String classId) {
    UmlClass umlClass = byId.get(classId);

    return umlClass == null ? "?" : umlClass.name();
  }

  public String basePackage() {
    return request.packageOrDefault();
  }

  public String artifactId() {
    return request.artifactOrDefault();
  }

  public String entityPackage() {
    return basePackage() + ".entity";
  }

  public String repositoryPackage() {
    return basePackage() + ".repository";
  }

  public String servicePackage() {
    return basePackage() + ".service";
  }

  public String controllerPackage() {
    return basePackage() + ".controller";
  }

  public ClassName entityType(UmlClass umlClass) {
    return ClassName.get(entityPackage(), Names.pascal(umlClass.name()));
  }

  public ClassName repositoryType(UmlClass umlClass) {
    return ClassName.get(repositoryPackage(), Names.pascal(umlClass.name()) + "Repository");
  }

  public ClassName serviceType(UmlClass umlClass) {
    return ClassName.get(servicePackage(), Names.pascal(umlClass.name()) + "Service");
  }

  public ClassName controllerType(UmlClass umlClass) {
    return ClassName.get(controllerPackage(), Names.pascal(umlClass.name()) + "Controller");
  }

  /** Una clase con estereotipo «service» se llama tal como la nombró el usuario. */
  public ClassName standaloneServiceType(UmlClass umlClass) {
    return ClassName.get(servicePackage(), Names.pascal(umlClass.name()));
  }

  /**
   * El tipo Java de un tipo escrito en el diagrama: uno del catálogo, o una
   * clase del propio diagrama cuando es el retorno o el parámetro de un método.
   */
  public TypeName resolve(String umlType) {
    if ("void".equals(umlType)) {
      return TypeName.VOID;
    }
    TypeName catalog = JavaTypes.of(umlType);
    if (catalog != null) {
      return catalog;
    }

    UmlClass referenced = byName.get(umlType);
    if (referenced == null) {
      return ClassName.get(Object.class);
    }
    return referenced.hasStereotype("service")
        ? standaloneServiceType(referenced)
        : entityType(referenced);
  }

  public EntityPlan planOf(UmlClass umlClass) {
    return entities.stream()
        .filter(plan -> plan.umlClass().id().equals(umlClass.id()))
        .findFirst()
        .orElse(null);
  }
}
