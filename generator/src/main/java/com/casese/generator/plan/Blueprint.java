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

    // Cada clase persistente, con su clave primaria y sus columnas. Los enlaces
    // se añaden después, cuando ya se sabe qué nombres están ocupados.
    Map<String, EntityPlan.Id> ids = new LinkedHashMap<>();
    Map<String, List<UmlAttribute>> columns = new LinkedHashMap<>();
    Map<String, Set<String>> taken = new LinkedHashMap<>();
    Map<String, List<Link>> links = new LinkedHashMap<>();

    // Primero todas las claves primarias: una subclase necesita saber cómo se
    // llama la de su padre, y el padre puede estar más abajo en la lista.
    for (UmlClass umlClass : model.classes()) {
      if (isPersistent(umlClass)) {
        ids.put(umlClass.id(), parents.containsKey(umlClass.id()) ? null : identifierOf(umlClass));
      }
    }

    for (UmlClass umlClass : model.classes()) {
      if (!isPersistent(umlClass)) {
        continue;
      }
      EntityPlan.Id id = ids.get(umlClass.id());
      String idName = id != null ? id.name() : inheritedIdName(umlClass, parents, ids);

      List<UmlAttribute> own = columnsOf(umlClass, id, idName);
      columns.put(umlClass.id(), own);

      Set<String> used = new LinkedHashSet<>();
      if (idName != null) {
        used.add(idName);
      }
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
              ids.get(umlClass.id()),
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

  /** El nombre del {@code @Id} que la clase hereda, subiendo hasta la raíz. */
  private String inheritedIdName(
      UmlClass umlClass, Map<String, UmlClass> parents, Map<String, EntityPlan.Id> ids) {

    UmlClass current = umlClass;
    Set<String> visited = new HashSet<>();

    while (current != null && visited.add(current.id())) {
      EntityPlan.Id id = ids.get(current.id());
      if (id != null) {
        return id.name();
      }
      current = parents.get(current.id());
    }
    return null;
  }

  /**
   * La clave primaria de una clase raíz.
   *
   * <p>Si el diagrama no marca ninguna se inventa un {@code Long id}
   * autogenerado: una clase dibujada sin clave primaria casi siempre es una a
   * la que aún no se le ha puesto, no una que no la quiera. Un atributo llamado
   * «id» sin marcar se toma como la clave, que es lo que evidentemente quiere
   * decir.
   */
  private EntityPlan.Id identifierOf(UmlClass umlClass) {
    UmlAttribute key = umlClass.primaryKey();

    if (key == null) {
      key =
          umlClass.attributes().stream()
              .filter(attribute -> attribute.name().equalsIgnoreCase("id"))
              .findFirst()
              .orElse(null);
    }

    if (key == null) {
      return new EntityPlan.Id("id", ClassName.get(Long.class), true, true);
    }

    if (!key.hasType() || !JavaTypes.isCatalogType(key.dataType())) {
      notes.add(
          "La clave primaria %s.%s no tiene un tipo del catálogo; se genera como Long autogenerado."
              .formatted(umlClass.name(), key.name()));
      return new EntityPlan.Id(key.name(), ClassName.get(Long.class), true, false);
    }

    // Sólo se autogenera lo que la base sabe producir. Una clave de tipo String
    // o una fecha la trae quien da de alta el registro.
    boolean generated =
        switch (key.dataType()) {
          case "Long", "Integer", "UUID" -> true;
          default -> false;
        };
    return new EntityPlan.Id(key.name(), JavaTypes.of(key.dataType()), generated, false);
  }

  /** Los atributos que serán columnas: ni la clave primaria ni los que no tienen tipo. */
  private List<UmlAttribute> columnsOf(UmlClass umlClass, EntityPlan.Id id, String inheritedId) {
    List<UmlAttribute> result = new ArrayList<>();

    for (UmlAttribute attribute : umlClass.attributes()) {
      if (id != null && !id.synthetic() && attribute.name().equals(id.name())) {
        continue;
      }
      // Una subclase no repite el identificador del padre: en Java ya lo tiene.
      if (id == null && attribute.name().equals(inheritedId)) {
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

  /** El identificador de la entidad, mirando hacia arriba si lo hereda. */
  public EntityPlan.Id identifierFor(EntityPlan plan) {
    EntityPlan current = plan;
    Set<String> visited = new HashSet<>();

    while (current != null && visited.add(current.umlClass().id())) {
      if (current.id() != null) {
        return current.id();
      }
      UmlClass parent = current.parent();
      current = parent == null ? null : planOf(parent);
    }
    return new EntityPlan.Id("id", ClassName.get(Long.class), true, true);
  }

  public EntityPlan planOf(UmlClass umlClass) {
    return entities.stream()
        .filter(plan -> plan.umlClass().id().equals(umlClass.id()))
        .findFirst()
        .orElse(null);
  }
}
