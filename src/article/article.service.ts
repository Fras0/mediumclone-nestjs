import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateArticleDto } from './dto/createArticle.dto';
import { ArticleEntity } from './article.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '@app/user/user.entity';
import { ArticleResponseInterface } from './types/articleResponse.interface';
import slugify from 'slugify';
import { DeleteResult } from 'typeorm/browser';
import { ArticlesResponseInterface } from './types/articlesResponse.interface';

@Injectable()
export class ArticleService {
  constructor(
    @InjectRepository(ArticleEntity)
    private readonly articleRepository: Repository<ArticleEntity>,
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async findAll(
    currentUserId: number,
    query: any,
  ): Promise<ArticlesResponseInterface> {
    const queryBuilder = this.dataSource
      .getRepository(ArticleEntity)
      .createQueryBuilder('articles')
      .leftJoinAndSelect('articles.author', 'author');

    if (query.tag) {
      queryBuilder.andWhere('articles.tagList LIKE :tag', {
        tag: `%${query.tag}%`,
      });
    }

    if (query.author) {
      const author = await this.userRepository.findOne({
        where: { username: query.author },
      });
      if (!author) {
        return { articles: [], articlesCount: 0 };
      }
      queryBuilder.andWhere('articles.authorId = :id', {
        id: author.id,
      });
    }

    if (query.favorited) {
      const user = await this.userRepository.findOne({
        where: { username: query.favorited },
        relations: ['favorites'],
      });
      if (!user || user.favorites.length === 0) {
        return { articles: [], articlesCount: 0 };
      }
      queryBuilder.andWhere('articles.id IN (:...ids)', {
        ids: user.favorites.map((favorite) => favorite.id),
      });
    }

    queryBuilder.orderBy('articles.createdAt', 'DESC');

    const articlesCount = await queryBuilder.getCount();

    if (query.limit) {
      queryBuilder.limit(query.limit);
    }

    if (query.offset) {
      queryBuilder.offset(query.offset);
    }

    let favouritesIds: number[] = [];
    if (currentUserId) {
      const currentUser = await this.userRepository.findOne({
        where: { id: currentUserId },
        relations: ['favorites'],
      });

      if (currentUser) {
        favouritesIds = currentUser.favorites.map((favorite) => favorite.id);
      }
    }

    const articles = await queryBuilder.getMany();
    const articlesWithFavorites = articles.map((article) => {
      const favorited = favouritesIds.includes(article.id);
      return { ...article, favorited };
    });
    return { articles: articlesWithFavorites, articlesCount };
  }

  async createArticle(
    currentUser: UserEntity,
    createArticleDto: CreateArticleDto,
  ): Promise<ArticleEntity> {
    const article = new ArticleEntity();
    Object.assign(article, createArticleDto);
    if (!createArticleDto.tagList) {
      article.tagList = [];
    } else {
      article.tagList = createArticleDto.tagList;
    }
    article.slug = this.getSlug(createArticleDto.title);

    article.author = currentUser;
    return await this.articleRepository.save(article);
  }

  async findBySlug(slug: string): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOne({ where: { slug } });
    if (!article) {
      throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
    }
    return article;
  }

  async addArticleToFavorites(
    slug: string,
    currentUserId: number,
  ): Promise<ArticleEntity> {
    const article = await this.findBySlug(slug);
    const user = await this.userRepository.findOne({
      where: { id: currentUserId },
      relations: ['favorites'],
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    const isFavorited = user.favorites.some(
      (favorite) => favorite.id === article.id,
    );
    if (isFavorited) {
      throw new HttpException(
        'Article is already in favorites',
        HttpStatus.BAD_REQUEST,
      );
    }
    user.favorites.push(article);
    article.favoritesCount++;
    await this.userRepository.save(user);
    await this.articleRepository.save(article);
    return article;
  }

  async removeArticleFromFavorites(
    slug: string,
    currentUserId: number,
  ): Promise<ArticleEntity> {
    const article = await this.findBySlug(slug);
    const user = await this.userRepository.findOne({
      where: { id: currentUserId },
      relations: ['favorites'],
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    const isFavorited = user.favorites.some(
      (favorite) => favorite.id === article.id,
    );
    if (!isFavorited) {
      throw new HttpException(
        'Article is not in favorites',
        HttpStatus.BAD_REQUEST,
      );
    }
    user.favorites = user.favorites.filter(
      (favorite) => favorite.id !== article.id,
    );
    article.favoritesCount--;
    await this.userRepository.save(user);
    await this.articleRepository.save(article);
    return article;
  }

  buildArticleResponse(article: ArticleEntity): ArticleResponseInterface {
    return { article };
  }

  private getSlug(title: string): string {
    return (
      slugify(title, { lower: true }) +
      '-' +
      ((Math.random() * Math.pow(36, 6)) | 0).toString(36)
    );
  }

  async deleteArticle(
    slug: string,
    currentUserId: number,
  ): Promise<DeleteResult> {
    const article = await this.findBySlug(slug);

    if (!article) {
      throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
    }
    if (article.author.id !== currentUserId) {
      throw new HttpException(
        'You are not the author of this article',
        HttpStatus.FORBIDDEN,
      );
    }
    return await this.articleRepository.delete({ slug });
  }

  async updateArticle(
    slug: string,
    updateArticleDto: CreateArticleDto,
    currentUserId: number,
  ): Promise<ArticleEntity> {
    const article = await this.findBySlug(slug);
    if (!article) {
      throw new HttpException('Article not found', HttpStatus.NOT_FOUND);
    }
    if (article.author.id !== currentUserId) {
      throw new HttpException(
        'You are not the author of this article',
        HttpStatus.FORBIDDEN,
      );
    }
    Object.assign(article, updateArticleDto);
    return await this.articleRepository.save(article);
  }
}
